/**
 * EXECUTION VERIFICATION for the driver execution + proof adversarial matrix
 * (§35 DRIVER+PROOF) and launch batch 3 §C/§30/§31:
 *   20260802020000..20260802070000  driver execution vocabulary/tables/commands
 *   20260903040000                  driver exceptions + undeliverable + cancel
 *
 * Same doctrine as paymentRecovery.mjs: a migration applying proves it
 * parses; only CALLING the commands against real rows proves they run. Every
 * check below EXECUTES a command (or probes the catalog with
 * has_function_privilege / has_table_privilege) — nothing here reads SQL text.
 *
 *   ACTOR BOUNDARY
 *   DX-01  a driver with no active assignment is refused (not_your_delivery)
 *   DX-02  assignment really moved the world: active row + driver on_delivery
 *   DX-03  driver A cannot execute driver B's delivery (byte-identical CR403)
 *   DX-04  stale version CAS is refused (CR409)
 *   DX-05  completion before pickup is refused (CR409)
 *   DX-41  no driver command takes a price/amount/policy/fee parameter
 *          (proved from pg_proc argnames, the catalog — not from source text)
 *   DX-42  authenticated holds no UPDATE on any driver-execution table
 *   DX-43  anon/authenticated hold EXECUTE on NOTHING in the family
 *   DX-44  service_role holds EXECUTE on the three new commands
 *
 *   ARRIVAL EVIDENCE
 *   DX-06  arrival without coordinates is refused          CR400
 *   DX-07  out-of-range coordinates are refused            CR400
 *   DX-08  the arrival timestamp is SERVER time, written in the command's own
 *          transaction (event.created_at = delivery.updated_at, both now())
 *
 *   HANDOFF PIN
 *   DX-09  a wrong digest is 'invalid', never an exception
 *   DX-10  a raw six-digit code is unstorable: the issue command refuses it
 *          (CR400) and the table CHECK refuses a direct insert (23514)
 *   DX-11  the fifth failure locks the code
 *   DX-12  a locked code refuses even the CORRECT digest
 *   DX-13  a regenerated code verifies; the old generation is superseded
 *   DX-14  the stored column can only ever hold a 64-hex DIGEST (constraint
 *          definition read from the catalog), so no function can return the
 *          raw code — the database never has it
 *
 *   DISCREPANCY / §31 EXCEPTION
 *   DX-15  the driver opens a pickup discrepancy (stage defaults to 'pickup')
 *   DX-16  an open discrepancy blocks complete_pickup      CR409
 *   DX-17  Operations safe_to_continue unblocks (next gate is now the photo)
 *   DX-18  the full pickup gauntlet completes: consumed code + two finalized
 *          photos -> picked_up
 *   DX-19  a replayed complete_pickup is refused           CR409
 *   DX-20  §31: report_dropoff_exception records an OPEN row with
 *          stage='dropoff' and changes neither state nor version
 *   DX-21  ... and its delivery event (from = to = in_transit)
 *   DX-22  ... idempotently: a second report returns the SAME row
 *   DX-23  ... and an unassigned driver cannot report      CR403
 *   DX-24  ... and it gates nothing: arrive_at_dropoff still works
 *
 *   UNDELIVERABLE CLOSURE (the stranded-driver fix)
 *   DX-25  Operations closes at_dropoff -> could_not_deliver
 *   DX-26  the assignment is CLOSED (cancelled / could_not_deliver, stamped)
 *   DX-27  the driver AND vehicle come back 'available'
 *   DX-28  replay is idempotent: same row back, exactly one event
 *   DX-29  a non-Operations actor is refused               CR403
 *   DX-33  a delivered delivery cannot be closed           CR409
 *   DX-35  closure also works from at_pickup (the failed-pickup stage)
 *
 *   PROOF-GATED COMPLETION
 *   DX-30  complete_signature without a finalized signature proof row is
 *          refused (signature_required) — a browser boolean is not proof
 *   DX-31  with the proof row it completes; assignment completed/delivered
 *   DX-32  a duplicate completion is refused — MEASURED as the opaque CR403
 *          actor refusal (the completion closed the assignment in the same
 *          transaction), with exactly one completion event either way
 *
 *   GOVERNED CANCELLATION (§30)
 *   DX-34  cancel is refused from at_pickup (too late — that is the
 *          undeliverable/failed-pickup path)
 *   DX-36  cancel works from 'assigned': delivery cancelled, nothing deleted
 *   DX-37  the assignment is cancelled and the driver is released
 *   DX-38  replay is idempotent: same row, exactly one event
 *   DX-39  NOTHING was deleted: delivery, assignments and events all remain
 *   DX-40  a non-Operations actor cannot cancel            CR403
 *
 *   DX-45  the seeded fixtures leave couranr_foundation_integrity() clean
 *
 * Run against a PRIVATE disposable cluster:
 *   COURANR_DISPOSABLE_PORT=... COURANR_DISPOSABLE_DIR=... \
 *     node e2e/disposable/driverExecution.mjs
 */
import crypto from "node:crypto";
import { up, psql } from "./up.mjs";
import {
  gateAIntegrityIssues,
  psqlTransport,
  seedCanonicalDeliveryChain,
} from "./gateAFixtures.mjs";

let pass = 0;
let fail = 0;
const one = (sql) => psql(sql).trim();
const esc = (s) => String(s).replace(/'/g, "''");
function ok(id, label, got) {
  pass += 1;
  console.log(`  PASS  ${id}  ${label}${got === undefined ? "" : `  [${got}]`}`);
}
function bad(id, label, got) {
  fail += 1;
  console.log(`  FAIL  ${id}  ${label}  [${got}]`);
}
function eq(id, label, got, want) {
  String(got) === String(want) ? ok(id, label, got) : bad(id, label, `got ${got}, want ${want}`);
}
function raises(sql) {
  const body = sql.replace(/;\s*$/, "");
  const stmt = /^\s*select\b/i.test(body) ? `perform ( ${body} );` : `${body};`;
  return psql(
    `create temp table _probe(code text, msg text);
     do $probe$ begin
       ${stmt}
       insert into _probe values ('NO_ERROR', '');
     exception when others then
       insert into _probe values (SQLSTATE, SQLERRM);
     end $probe$;
     select code || '|' || msg from _probe;`,
  ).trim();
}
const rowOf = (sql) => JSON.parse(one(`select row_to_json(t) from ${sql} t`));

function seedActor(email, role) {
  const id = one(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  psql(
    `insert into public.profiles (id, email, role) values ('${id}', '${esc(email)}', '${role}')
       on conflict (id) do update set role = excluded.role`,
  );
  return id;
}

/* ------------------------------------------------------- SQL wrappers --- */

const dlv = (id, col = "fulfillment_state") =>
  one(`select ${col}::text from public.couranr_deliveries where id='${id}'`);
const dver = (id) => Number(dlv(id, "version"));
const drvCol = (id, col) => one(`select ${col}::text from public.couranr_drivers where id='${id}'`);
const vehCol = (id, col) =>
  one(`select ${col}::text from public.couranr_dispatch_vehicles where id='${id}'`);

const startRoute = (d, v, actor) =>
  `select public.couranr_start_route_to_pickup('${d}', ${v}, '${actor}')`;
const arrivePickup = (d, v, actor, lat, lng) =>
  `select public.couranr_arrive_at_pickup('${d}', ${v}, '${actor}', ${lat}, ${lng}, 12)`;
const completePickup = (d, v, actor, vehicleId) =>
  `select public.couranr_complete_pickup('${d}', ${v}, '${actor}', 2, 'Sam', '${vehicleId}',
      38.42, -77.40, 8.5, null, null, null, null, null)`;

function issueCode(deliveryId, kind, digest, actor) {
  return rowOf(
    `public.couranr_issue_handoff_code('${deliveryId}', '${kind}', '${digest}', '${actor}', 60)`,
  );
}
// Actor-scoped since 20260802070000: only the ASSIGNED driver may attempt.
const verifyCode = (deliveryId, kind, digest, actorUser) =>
  one(`select (public.couranr_verify_handoff_code('${deliveryId}', '${kind}', '${digest}', '${actorUser}')).outcome`);

const digestOf = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Issue + finalize a proof upload the way the product does, storage facts matching. */
function seedProof(deliveryId, driverUser, stage, type) {
  const objectPath = `canonical-proof/v1/${deliveryId}/${crypto.randomUUID()}/${crypto
    .randomBytes(16)
    .toString("hex")}.jpg`;
  const upload = rowOf(
    `public.couranr_create_proof_upload('${deliveryId}', '${driverUser}', '${stage}', '${type}',
       'delivery-photos', '${objectPath}', 'image/jpeg', 1234,
       '${crypto.randomBytes(16).toString("hex")}', 15)`,
  );
  return rowOf(
    `public.couranr_finalize_proof_upload('${upload.id}', '${driverUser}', '${objectPath}',
       1234, 'image/jpeg', 38.42, -77.40, 9, null, null)`,
  );
}

async function main() {
  up();
  const t = psqlTransport(psql);

  console.log("\n  driver execution + exceptions + cancellation — execution verification\n");

  /* ------------------------------------------------------- fixtures ----- */

  const bizId = one(
    `insert into public.business_accounts (name, slug, status)
     values ('Driver Exec Co', 'driver-exec-${crypto.randomUUID().slice(0, 8)}', 'active') returning id`,
  );
  const ops = seedActor(`ops+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "admin");
  const merchant = seedActor(`mer+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "merchant");
  psql(`insert into public.business_members (business_account_id, user_id, role, status)
        values ('${bizId}', '${merchant}', 'owner', 'active')`);
  const drvAUser = seedActor(`drva+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "driver");
  const drvBUser = seedActor(`drvb+${crypto.randomUUID().slice(0, 8)}@e2e.couranr.test`, "driver");

  /** A canonical driver: created, activated and made available through the
      NAMED commands, never by setting a column. */
  function seedDriver(userId, name) {
    const row = rowOf(
      `public.couranr_create_driver_profile('${userId}', '${ops}', '${esc(name)}', null, null)`,
    );
    const activated = rowOf(`public.couranr_activate_driver('${row.id}', ${row.version}, '${ops}')`);
    rowOf(`public.couranr_mark_driver_available('${row.id}', ${activated.version}, '${ops}')`);
    return row.id;
  }
  function seedVehicle(name) {
    return rowOf(
      `public.couranr_create_dispatch_vehicle('${ops}', '${esc(name)}', 'van', 2000,
         null, null, null, null, true, false, false, false, true)`,
    ).id;
  }
  const driverA = seedDriver(drvAUser, "[E2E] Driver A");
  const driverB = seedDriver(drvBUser, "[E2E] Driver B");
  const vehA = seedVehicle("[E2E] Van A");
  const vehB = seedVehicle("[E2E] Van B");

  const seedDelivery = async (marker, opts = {}) =>
    seedCanonicalDeliveryChain(t, {
      businessId: bizId,
      actorUserId: merchant,
      marker,
      stopAfter: "delivery",
      ...opts,
    });

  const assign = (deliveryId, driverId, vehicleId) =>
    rowOf(
      `public.couranr_assign_delivery('${deliveryId}', ${dver(deliveryId)}, '${ops}',
         '${driverId}', '${vehicleId}', 'asg-${crypto.randomUUID()}')`,
    );

  /* ================================== D1: the full adversarial walk ===== */

  const D1 = (await seedDelivery(`dx1-${crypto.randomUUID().slice(0, 6)}`)).deliveryId;

  eq("DX-01", "a driver with no assignment gets not_your_delivery",
     raises(startRoute(D1, 1, drvBUser)), "CR403|not_your_delivery");

  const asg1 = assign(D1, driverA, vehA);
  eq("DX-02a", "assignment is active on the delivery",
     `${asg1.assignment_state}|${dlv(D1)}`, "active|assigned");
  eq("DX-02b", "the driver is pinned on_delivery",
     drvCol(driverA, "availability_state"), "on_delivery");

  const D2 = (await seedDelivery(`dx2-${crypto.randomUUID().slice(0, 6)}`, {
    proofMethod: "signature",
    signatureRequired: true,
  })).deliveryId;
  assign(D2, driverB, vehB);
  eq("DX-03", "driver A cannot execute driver B's delivery (identical refusal)",
     raises(startRoute(D2, dver(D2), drvAUser)), "CR403|not_your_delivery");

  eq("DX-04", "a stale version is a CAS refusal",
     raises(startRoute(D1, 99, drvAUser)), "CR409|delivery_not_in_expected_state");
  eq("DX-05", "completion before pickup is refused",
     raises(completePickup(D1, dver(D1), drvAUser, vehA)), "CR409|delivery_not_in_expected_state");

  psql(startRoute(D1, dver(D1), drvAUser));
  eq("DX-06", "arrival without coordinates is refused",
     raises(arrivePickup(D1, dver(D1), drvAUser, "null", "null")), "CR400|location_required");
  eq("DX-07", "out-of-range coordinates are refused",
     raises(arrivePickup(D1, dver(D1), drvAUser, 95, -77.4)), "CR400|location_out_of_range");
  psql(arrivePickup(D1, dver(D1), drvAUser, 38.42, -77.40));
  eq("DX-08", "the arrival timestamp is server time inside the command's transaction",
     one(`select ((e.created_at = d.updated_at)
                  and e.created_at > now() - interval '2 minutes')::text
            from public.couranr_delivery_events e
            join public.couranr_deliveries d on d.id = e.delivery_id
           where d.id = '${D1}' and e.command = 'arrive_at_pickup'`),
     "true");

  /* --------------------------------------------------------- PIN -------- */

  const goodDigest = digestOf("code-1");
  issueCode(D1, "merchant_pickup", goodDigest, ops);
  eq("DX-09", "a wrong digest is 'invalid', not an exception",
     verifyCode(D1, "merchant_pickup", digestOf("wrong"), drvAUser), "invalid");
  eq("DX-10a", "the issue command refuses a raw six-digit code",
     raises(`select public.couranr_issue_handoff_code('${D1}','merchant_pickup','123456','${ops}',60)`),
     "CR400|digest_required");
  eq("DX-10b", "the schema refuses a raw six-digit code outright",
     raises(`insert into public.couranr_handoff_codes
               (delivery_id, code_kind, generation, code_digest, code_state, issued_by, expires_at)
             values ('${D1}','recipient_dropoff',1,'123456','active','${ops}',now()+interval '1 hour')`)
       .split("|")[0],
     "23514");
  for (let i = 0; i < 3; i += 1) verifyCode(D1, "merchant_pickup", digestOf(`wrong-${i}`), drvAUser);
  eq("DX-11", "the fifth failure locks the code",
     verifyCode(D1, "merchant_pickup", digestOf("wrong-final"), drvAUser), "locked");
  eq("DX-12", "a locked code refuses even the correct digest",
     verifyCode(D1, "merchant_pickup", goodDigest, drvAUser), "locked");
  const gen2Digest = digestOf("code-2");
  const gen2 = issueCode(D1, "merchant_pickup", gen2Digest, ops);
  eq("DX-13", "a regenerated code verifies and the locked one is superseded",
     `${gen2.generation}|${verifyCode(D1, "merchant_pickup", gen2Digest, drvAUser)}|` +
       one(`select code_state from public.couranr_handoff_codes
             where delivery_id='${D1}' and code_kind='merchant_pickup' and generation=1`),
     "2|accepted|superseded");
  eq("DX-14", "the stored column can only hold a 64-hex digest — the raw code never enters the database",
     one(`select (pg_get_constraintdef(oid) like '%[0-9a-f]{64}%')::text
            from pg_constraint
           where conrelid = 'public.couranr_handoff_codes'::regclass
             and conname = 'couranr_hc_digest_shape_chk'`),
     "true");

  /* ------------------------------------------------- discrepancy -------- */

  const disc = rowOf(
    `public.couranr_report_pickup_discrepancy('${D1}', '${drvAUser}', 'package_count_mismatch', 'two boxes short')`,
  );
  eq("DX-15", "the driver opened a pickup discrepancy (stage defaults to pickup)",
     `${disc.discrepancy_state}|${disc.stage}`, "open|pickup");
  eq("DX-16", "an open discrepancy blocks complete_pickup",
     raises(completePickup(D1, dver(D1), drvAUser, vehA)), "CR409|pickup_discrepancy_open");
  rowOf(
    `public.couranr_resolve_pickup_discrepancy_safe_to_continue('${disc.id}', ${disc.version}, '${ops}', 'counted again with staff')`,
  );
  eq("DX-17", "safe_to_continue lifts the block (the next gate is now the photo)",
     raises(completePickup(D1, dver(D1), drvAUser, vehA)), "CR409|shipment_photo_required");

  seedProof(D1, drvAUser, "pickup", "shipment_photo");
  seedProof(D1, drvAUser, "pickup", "condition_photo");
  psql(completePickup(D1, dver(D1), drvAUser, vehA));
  eq("DX-18", "the full pickup gauntlet completes", dlv(D1), "picked_up");
  eq("DX-19", "a replayed complete_pickup is refused",
     raises(completePickup(D1, dver(D1) - 1, drvAUser, vehA)),
     "CR409|delivery_not_in_expected_state");

  /* ------------------------------------------- §31 drop-off exception --- */

  psql(`select public.couranr_start_route_to_dropoff('${D1}', ${dver(D1)}, '${drvAUser}')`);
  const verBefore = dver(D1);
  const exc = rowOf(
    `public.couranr_report_dropoff_exception('${D1}', '${drvAUser}', 'recipient_unavailable', 'nobody answers')`,
  );
  eq("DX-20", "the exception is an OPEN dropoff-stage row; state and version unmoved",
     `${exc.discrepancy_state}|${exc.stage}|${dlv(D1)}|${dver(D1) === verBefore}`,
     "open|dropoff|in_transit|true");
  eq("DX-21", "its delivery event is recorded without a state change",
     one(`select from_state || '>' || to_state || '|' || count(*) over ()
            from public.couranr_delivery_events
           where delivery_id='${D1}' and command='report_dropoff_exception' limit 1`),
     "in_transit>in_transit|1");
  const excReplay = rowOf(
    `public.couranr_report_dropoff_exception('${D1}', '${drvAUser}', 'other', 'second report')`,
  );
  eq("DX-22", "a second report returns the SAME open row",
     `${excReplay.id === exc.id}|` +
       one(`select count(*) from public.couranr_pickup_discrepancies
             where delivery_id='${D1}' and discrepancy_state='open'`),
     "true|1");
  eq("DX-23", "an unassigned driver cannot report an exception",
     raises(`select public.couranr_report_dropoff_exception('${D1}', '${drvBUser}', 'other', 'x')`),
     "CR403|not_your_delivery");
  psql(`select public.couranr_arrive_at_dropoff('${D1}', ${dver(D1)}, '${drvAUser}', 38.30, -77.46, 10)`);
  eq("DX-24", "the open exception gates nothing — the driver still progressed",
     dlv(D1), "at_dropoff");

  /* ------------------------------------------- undeliverable closure ---- */

  eq("DX-29", "a non-Operations actor cannot close a delivery undeliverable",
     raises(`select public.couranr_close_delivery_undeliverable('${D1}', ${dver(D1)}, '${drvAUser}', 'no', null)`),
     "CR403|operations_access_required");
  psql(`select public.couranr_close_delivery_undeliverable('${D1}', ${dver(D1)}, '${ops}', 'recipient never appeared', 'at_dropoff')`);
  eq("DX-25", "Operations closed at_dropoff -> could_not_deliver", dlv(D1), "could_not_deliver");
  eq("DX-26", "the assignment is closed with the truthful end reason",
     one(`select assignment_state || '|' || end_reason || '|' || (ended_at is not null)::text
            from public.couranr_delivery_assignments where id='${asg1.id}'`),
     "cancelled|could_not_deliver|true");
  eq("DX-27", "the driver AND the vehicle came back available",
     `${drvCol(driverA, "availability_state")}|${vehCol(vehA, "availability_state")}`,
     "available|available");
  const replayed = rowOf(
    `public.couranr_close_delivery_undeliverable('${D1}', 999, '${ops}', 'again', null)`,
  );
  eq("DX-28", "replay is idempotent: same row back, exactly one event",
     `${replayed.fulfillment_state}|` +
       one(`select count(*) from public.couranr_delivery_events
             where delivery_id='${D1}' and command='close_delivery_undeliverable'`),
     "could_not_deliver|1");

  /* ------------------------------------- proof-gated completion (D2) ---- */

  psql(startRoute(D2, dver(D2), drvBUser));
  psql(arrivePickup(D2, dver(D2), drvBUser, 38.42, -77.40));
  const d2Digest = digestOf("d2-code");
  issueCode(D2, "merchant_pickup", d2Digest, ops);
  verifyCode(D2, "merchant_pickup", d2Digest, drvBUser);
  seedProof(D2, drvBUser, "pickup", "shipment_photo");
  seedProof(D2, drvBUser, "pickup", "condition_photo");
  psql(completePickup(D2, dver(D2), drvBUser, vehB));
  psql(`select public.couranr_start_route_to_dropoff('${D2}', ${dver(D2)}, '${drvBUser}')`);
  psql(`select public.couranr_arrive_at_dropoff('${D2}', ${dver(D2)}, '${drvBUser}', 38.30, -77.46, 10)`);

  const completeSignature = () =>
    `select public.couranr_complete_signature_delivery('${D2}', ${dver(D2)}, '${drvBUser}', 'Riley', 38.30, -77.46, 10)`;
  eq("DX-30", "signature completion without a FINALIZED signature proof row is refused",
     raises(completeSignature()), "CR409|signature_required");
  seedProof(D2, drvBUser, "dropoff", "signature");
  psql(completeSignature());
  eq("DX-31a", "with the proof row the delivery completes", dlv(D2), "delivered");
  eq("DX-31b", "the assignment completed and the driver was released",
     one(`select a.assignment_state || '|' || a.end_reason
            from public.couranr_delivery_assignments a
           where a.delivery_id='${D2}' order by a.created_at desc limit 1`) +
       `|${drvCol(driverB, "availability_state")}`,
     "completed|delivered|available");
  // MEASURED, not assumed: the matrix says "duplicate completion CR409", but
  // couranr_finish_delivered closes the assignment in the SAME transaction as
  // the completion, so a replay hits the actor gate FIRST and gets the same
  // opaque CR403 an unassigned driver gets. The refusal is earlier and reveals
  // less; the invariant that matters — the delivery completed exactly once —
  // is asserted alongside it.
  eq("DX-32a", "a duplicate completion is refused (opaque actor refusal)",
     raises(completeSignature()), "CR403|not_your_delivery");
  eq("DX-32b", "... and exactly ONE completion event exists",
     one(`select count(*) from public.couranr_delivery_events
           where delivery_id='${D2}' and command='complete_signature_delivery'`),
     "1");
  eq("DX-33", "a delivered delivery cannot be closed undeliverable",
     raises(`select public.couranr_close_delivery_undeliverable('${D2}', ${dver(D2)}, '${ops}', 'no', null)`),
     "CR409|delivery_not_closable_from_state");

  /* ------------------------------------------------ cancellation -------- */

  const D3 = (await seedDelivery(`dx3-${crypto.randomUUID().slice(0, 6)}`)).deliveryId;
  assign(D3, driverA, vehA);
  psql(startRoute(D3, dver(D3), drvAUser));
  psql(arrivePickup(D3, dver(D3), drvAUser, 38.42, -77.40));
  eq("DX-34", "cancel is refused once the driver has arrived (too late)",
     raises(`select public.couranr_cancel_delivery('${D3}', ${dver(D3)}, '${ops}', 'changed mind')`),
     "CR409|too_late_to_cancel");
  psql(`select public.couranr_close_delivery_undeliverable('${D3}', ${dver(D3)}, '${ops}', 'failed pickup — merchant unavailable', 'at_pickup')`);
  eq("DX-35", "undeliverable closure also works from at_pickup (failed pickup)",
     `${dlv(D3)}|${drvCol(driverA, "availability_state")}`, "could_not_deliver|available");

  const D4 = (await seedDelivery(`dx4-${crypto.randomUUID().slice(0, 6)}`)).deliveryId;
  const asg4 = assign(D4, driverA, vehA);
  eq("DX-40", "a non-Operations actor cannot cancel",
     raises(`select public.couranr_cancel_delivery('${D4}', ${dver(D4)}, '${merchant}', 'please')`),
     "CR403|operations_access_required");
  psql(`select public.couranr_cancel_delivery('${D4}', ${dver(D4)}, '${ops}', 'merchant cancelled the order')`);
  eq("DX-36", "cancel works from assigned", dlv(D4), "cancelled");
  eq("DX-37", "the assignment is cancelled and the driver released",
     one(`select assignment_state || '|' || end_reason from public.couranr_delivery_assignments
           where id='${asg4.id}'`) + `|${drvCol(driverA, "availability_state")}`,
     "cancelled|cancelled|available");
  const cancelReplay = rowOf(
    `public.couranr_cancel_delivery('${D4}', 999, '${ops}', 'again')`,
  );
  eq("DX-38", "replay is idempotent: same row, exactly one event",
     `${cancelReplay.fulfillment_state}|` +
       one(`select count(*) from public.couranr_delivery_events
             where delivery_id='${D4}' and command='cancel_delivery'`),
     "cancelled|1");
  eq("DX-39", "nothing was deleted: delivery, assignment and events all remain",
     one(`select (select count(*) from public.couranr_deliveries where id in ('${D1}','${D2}','${D3}','${D4}'))
                 || '|' ||
                 (select count(*) from public.couranr_delivery_assignments
                   where delivery_id in ('${D1}','${D2}','${D3}','${D4}'))
                 || '|' ||
                 (select (count(*) > 0)::text from public.couranr_delivery_events
                   where delivery_id='${D4}')`),
     "4|4|true");

  /* --------------------------------------------- privilege boundary ----- */

  const FAMILY = [
    "couranr_driver_assignment_for",
    "couranr_release_assignment_resources",
    "couranr_start_route_to_pickup",
    "couranr_arrive_at_pickup",
    "couranr_start_route_to_dropoff",
    "couranr_arrive_at_dropoff",
    "couranr_complete_pickup",
    "couranr_finish_delivered",
    "couranr_assert_dropoff_ready",
    "couranr_complete_direct_handoff_delivery",
    "couranr_complete_signature_delivery",
    "couranr_complete_leave_at_door_delivery",
    "couranr_unassign_delivery_before_pickup",
    "couranr_issue_handoff_code",
    "couranr_verify_handoff_code",
    "couranr_create_proof_upload",
    "couranr_finalize_proof_upload",
    "couranr_report_pickup_discrepancy",
    "couranr_resolve_pickup_discrepancy_safe_to_continue",
    "couranr_report_dropoff_exception",
    "couranr_close_delivery_undeliverable",
    "couranr_cancel_delivery",
  ];
  const familyList = FAMILY.map((f) => `'${f}'`).join(",");

  eq("DX-41", "no driver/closure command takes a price, amount, fee, policy or route parameter",
     one(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (${familyList})
             and array_to_string(p.proargnames, ',')
                 ~* '(amount|price|cents|fee|polic|route_|retention|surcharge)'`),
     "0");
  eq("DX-42", "authenticated holds no UPDATE on any driver-execution table",
     one(`select bool_or(has_table_privilege('authenticated', 'public.' || t, 'UPDATE'))::text
            from unnest(array['couranr_deliveries','couranr_delivery_assignments',
                              'couranr_pickup_discrepancies','couranr_handoff_codes',
                              'couranr_delivery_proofs','couranr_delivery_events']) as t`),
     "false");
  eq("DX-43", "anon/authenticated hold EXECUTE on NOTHING in the driver command family",
     one(`select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')
                      or has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (${familyList})`),
     "false");
  eq("DX-44", "service_role holds EXECUTE on the three new commands",
     one(`select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in
             ('couranr_report_dropoff_exception','couranr_close_delivery_undeliverable',
              'couranr_cancel_delivery')`),
     "true");

  const integrity = await gateAIntegrityIssues(t);
  eq("DX-45", "the seeded fixtures leave couranr_foundation_integrity() clean",
     integrity.join(",") || "clean", "clean");

  console.log(`\n  Driver execution: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\n  RUN FAILED:", e);
  process.exitCode = 1;
});
