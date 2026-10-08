import { sql } from "drizzle-orm";
import { verifyPassword as verifyScrypt } from "better-auth/crypto";
import type { authDb } from "@/lib/db/queries/base";

// Password hashing runs inside Postgres (pgcrypto's crypt() with bcrypt), the
// same way as the CloudRoot Worker (CloudRoot/worker/src/auth/password.js),
// so accounts made on either side sign in on both. The Worker can't hash in
// JavaScript under Cloudflare's CPU limit, which is why both use the
// database. Needs pgcrypto: lib/db/migrations/0014_pgcrypto.sql.
//
// Older accounts hold BetterAuth's default scrypt hashes ("<salt>:<key>").
// Those are checked with BetterAuth's own scrypt, then rewritten as bcrypt.
// bcrypt reads only the first 72 bytes of a password.

const BCRYPT_COST = 10;
const BCRYPT_PREFIX = /^\$2[aby]\$/;

function isBcrypt(hash: string): boolean {
  return BCRYPT_PREFIX.test(hash);
}

type Db = NonNullable<typeof authDb>;

type PasswordHashing = {
  hash: (password: string) => Promise<string>;
  verify: (data: { hash: string; password: string }) => Promise<boolean>;
};

export function databasePasswordHashing(db: Db): PasswordHashing {
  return {
    async hash(password: string): Promise<string> {
      const result = await db.execute(
        sql`select crypt(${password.normalize("NFKC")}, gen_salt('bf', ${BCRYPT_COST})) as hash`
      );
      return (result.rows[0] as { hash: string }).hash;
    },

    async verify({ hash, password }: { hash: string; password: string }): Promise<boolean> {
      const normalized = password.normalize("NFKC");
      if (isBcrypt(hash)) {
        const result = await db.execute(sql`select crypt(${normalized}, ${hash}) = ${hash} as ok`);
        return (result.rows[0] as { ok: boolean } | undefined)?.ok === true;
      }
      const ok = await verifyScrypt({ hash, password });
      if (ok) {
        await db.execute(
          sql`update account set password = crypt(${normalized}, gen_salt('bf', ${BCRYPT_COST})), updated_at = now()
              where provider_id = 'credential' and password = ${hash}`
        );
      }
      return ok;
    },
  };
}
