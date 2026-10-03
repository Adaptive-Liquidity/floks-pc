import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAN_CATALOG, PUBLIC_PRICE_LABEL } from "../../web/lib/billing/catalog.ts";
import {
  INTERNAL_DRAFT_ENTERPRISE_OVERAGE_PER_HOUR_CENTS,
  INTERNAL_DRAFT_OVERAGE_PER_HOUR_CENTS,
  INTERNAL_DRAFT_PRICE_MONTHLY_CENTS,
} from "../../web/lib/billing/internal-draft-prices.ts";
import {
  OVERCLAIM_PHRASES,
  publicCopyFiles,
  publicCopyViolations,
  publicCopyViolationsInTree,
} from "./public-copy-lint.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("public copy claims", () => {
  it("rejects overclaim phrases and draft dollar amounts in public copy", () => {
    assert.deepEqual(publicCopyViolationsInTree(), []);
  });

  it("flags each overclaim phrase and a draft price, including claims split across markup", () => {
    for (const phrase of OVERCLAIM_PHRASES) {
      assert.equal(publicCopyViolations(`<p>${phrase}</p>`).some((hit) => hit.kind === "overclaim"), true, phrase);
    }
    assert.equal(publicCopyViolations("governed execution").length > 0, true);
    assert.equal(publicCopyViolations("FLOKS").length > 0, true);
    assert.equal(publicCopyViolations("Statxion").length > 0, true);
    assert.equal(publicCopyViolations("Stations").length > 0, true);
    assert.equal(publicCopyViolations("open 24/7").length > 0, true);
    assert.equal(publicCopyViolations("∞ Persistent State").some((hit) => hit.phrase === "persistent state" || hit.phrase === "∞"), true);
    assert.equal(
      publicCopyViolations("Persistent<br />State").some((hit) => hit.phrase === "persistent state"),
      true,
    );
    assert.equal(
      publicCopyViolations("Full\nExecution").some((hit) => hit.phrase === "full execution"),
      true,
    );
    for (const sample of ["$29/mo", "$99 / 40h", "$79 per agent/mo", "$1.20/h", "79 per agent"]) {
      assert.equal(publicCopyViolations(sample).some((hit) => hit.kind === "price"), true, sample);
    }
    assert.deepEqual(publicCopyViolations("SELECT id WHERE email = $1"), []);
    assert.deepEqual(publicCopyViolations("$0 seats is fine."), []);
  });

  it("ignores research quotes and banlist definitions", () => {
    const quoted = `
      /* research-quote-start */
      powered by Continuum. SCOPED PERMISSIONS ARMED. $29/mo.
      /* research-quote-end */
      The product is Staxions by Asentxia.
    `;
    assert.deepEqual(publicCopyViolations(quoted), []);
    const listed = `
      /* banlist-definition-start */
      controlled execution
      $99/mo
      /* banlist-definition-end */
    `;
    assert.deepEqual(publicCopyViolations(listed), []);
    assert.equal(publicCopyViolations("controlled execution").length > 0, true);
  });

  it("keeps denial lines that refuse a banned phrase", () => {
    assert.deepEqual(publicCopyViolations("Do not claim production-ready security."), []);
    assert.deepEqual(publicCopyViolations("never floks-pc.com"), []);
    assert.deepEqual(publicCopyViolations("https://floks-pc-git.example"), []);
    assert.equal(publicCopyViolations("FLOKS Agent Computer").length > 0, true);
  });

  it("keeps unapproved draft cents off the rendered catalog and out of public imports", () => {
    assert.equal(PUBLIC_PRICE_LABEL, "Pricing to be confirmed");
    assert.equal(PLAN_CATALOG.personal.priceLabel, "Pricing to be confirmed");
    assert.equal(PLAN_CATALOG.pro.priceLabel, "Pricing to be confirmed");
    assert.equal(PLAN_CATALOG.team.priceLabel, "Pricing to be confirmed");
    assert.equal(PLAN_CATALOG.enterprise.priceLabel, "Contact us");
    assert.equal(INTERNAL_DRAFT_PRICE_MONTHLY_CENTS.personal, 2900);
    assert.equal(INTERNAL_DRAFT_PRICE_MONTHLY_CENTS.pro, 9900);
    assert.equal(INTERNAL_DRAFT_PRICE_MONTHLY_CENTS.team, 7900);
    assert.equal(INTERNAL_DRAFT_OVERAGE_PER_HOUR_CENTS, 120);
    assert.equal(INTERNAL_DRAFT_ENTERPRISE_OVERAGE_PER_HOUR_CENTS, 110);
    const draft = readFileSync(join(ROOT, "web/lib/billing/internal-draft-prices.ts"), "utf8");
    assert.doesNotMatch(draft, /\$\s*29|\$\s*99|\$\s*79|\$\s*1\.20/);
    for (const file of publicCopyFiles()) {
      const text = readFileSync(file, "utf8");
      assert.equal(/from\s+["'][^"']*internal-draft-prices|import\s*\(\s*["'][^"']*internal-draft-prices/u.test(text), false, file);
    }
  });
});
