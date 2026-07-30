import { describe, expect, it } from "vitest";
import {
  DELIVERY_PHOTOS_BUCKET,
  assertPersistableRef,
  buildStorageRef,
  parseStorageRef,
} from "@/lib/delivery/deliveryPhotoRef";

describe("delivery photo storage references", () => {
  it("round-trips a bucket and path", () => {
    const ref = buildStorageRef(DELIVERY_PHOTOS_BUCKET, "pickup/abc/1-photo.jpg");
    expect(ref).toBe("storage://delivery-photos/pickup/abc/1-photo.jpg");

    const parsed = parseStorageRef(ref);
    expect(parsed).toEqual({
      bucket: DELIVERY_PHOTOS_BUCKET,
      path: "pickup/abc/1-photo.jpg",
    });
  });

  it("normalises leading slashes in the path", () => {
    expect(buildStorageRef("b", "/x/y.jpg")).toBe("storage://b/x/y.jpg");
  });

  it("requires both a bucket and a path", () => {
    expect(() => buildStorageRef("", "x.jpg")).toThrow();
    expect(() => buildStorageRef("b", "")).toThrow();
  });

  it("returns null for anything that is not a storage reference", () => {
    expect(parseStorageRef(null)).toBeNull();
    expect(parseStorageRef("")).toBeNull();
    expect(parseStorageRef("https://example.supabase.co/x.jpg")).toBeNull();
    expect(parseStorageRef("storage://")).toBeNull();
    expect(parseStorageRef("storage://bucket-only")).toBeNull();
    expect(parseStorageRef("storage:///no-bucket.jpg")).toBeNull();
  });
});

/**
 * These are the tests that would have caught the original defect: the upload
 * route persisted a URL derived from `getPublicUrl()` into
 * `delivery_photos.photo_url`. Once the bucket became private that URL 400s,
 * and had it been a SIGNED url it would have been a stored credential.
 */
describe("assertPersistableRef refuses to persist credentials or URLs", () => {
  it("accepts a storage reference", () => {
    const ref = buildStorageRef(DELIVERY_PHOTOS_BUCKET, "pickup/a/b.jpg");
    expect(assertPersistableRef(ref)).toBe(ref);
  });

  it("rejects a signed URL (it carries a token)", () => {
    expect(() =>
      assertPersistableRef(
        "https://p.supabase.co/storage/v1/object/sign/delivery-photos/a.jpg?token=eyJhbGciOi"
      )
    ).toThrow();
  });

  it("rejects a public object URL", () => {
    expect(() =>
      assertPersistableRef(
        "https://p.supabase.co/storage/v1/object/public/delivery-photos/a.jpg"
      )
    ).toThrow();
  });

  it("rejects the /object/authenticated/ URL shape the customer route used to build", () => {
    expect(() =>
      assertPersistableRef(
        "https://p.supabase.co/storage/v1/object/authenticated/delivery-photos/a.jpg"
      )
    ).toThrow();
  });

  it("rejects an empty value", () => {
    expect(() => assertPersistableRef("")).toThrow();
    expect(() => assertPersistableRef("   ")).toThrow();
  });

  it("rejects a bare path that is not scheme-qualified", () => {
    expect(() => assertPersistableRef("pickup/abc/1-photo.jpg")).toThrow();
  });
});
