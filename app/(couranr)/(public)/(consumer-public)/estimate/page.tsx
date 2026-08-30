import { redirect } from "next/navigation";
import { routeForScreen } from "@/lib/couranr/navigation";

/**
 * PUB-004's COMPATIBILITY route.
 *
 * LEG-004 made `/send` the preferred direct-consumer entry and kept `/estimate`
 * in PUB-004's canonical route family. It is deliberately still a real page
 * rather than a deleted route: the screen source lists it, and a link printed
 * or shared before the rename has to keep resolving.
 *
 * A SERVER redirect, so the hop costs no client JavaScript and no flash of a
 * page that is about to leave. `redirect()` throws, so nothing renders here.
 */
export default function Page() {
  redirect(routeForScreen("PUB-004"));
}
