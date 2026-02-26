import crypto from "node:crypto";

const HASH_ITERATIONS = 120000;
const HASH_KEYLEN = 64;
const HASH_DIGEST = "sha512";

export const hashPassword = (password: string, salt?: string) => {
  const passwordSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, passwordSalt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST)
    .toString("hex");

  return { hash, salt: passwordSalt };
};

export const verifyPassword = (password: string, salt: string, hash: string) => {
  const { hash: candidate } = hashPassword(password, salt);
  return crypto.timingSafeEqual(
    Buffer.from(candidate, "hex"),
    Buffer.from(hash, "hex"),
  );
};
