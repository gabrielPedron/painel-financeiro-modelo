import test from "node:test";
import assert from "node:assert/strict";
import { imageBase64TooLarge, imageFileTooLarge, MAX_IMAGE_BYTES } from "./image-limit.ts";

test("imagem até 5 MB é aceita, acima de 5 MB é recusada", () => {
  const limite = Buffer.alloc(MAX_IMAGE_BYTES).toString("base64");
  const acima = Buffer.alloc(MAX_IMAGE_BYTES + 1).toString("base64");
  assert.equal(imageBase64TooLarge(`data:image/png;base64,${limite}`), false);
  assert.equal(imageBase64TooLarge(limite), false);
  assert.equal(imageBase64TooLarge(`data:image/png;base64,${acima}`), true);
  assert.equal(imageBase64TooLarge(acima), true);
  assert.equal(imageFileTooLarge({ size: MAX_IMAGE_BYTES }), false);
  assert.equal(imageFileTooLarge({ size: MAX_IMAGE_BYTES + 1 }), true);
});
