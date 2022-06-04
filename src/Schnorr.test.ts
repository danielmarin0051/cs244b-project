import { expect } from "chai";
import * as Schnorr from "./Schnorr";
import { Fr, PointG1, initSecp256k1 } from "./EC/secp256k1";

const encoder = new TextEncoder();

describe("Schnorr", function () {
    this.beforeAll(async () => {
        await initSecp256k1();
    });
    it("KeyGen()", () => {
        const { sk, pk } = Schnorr.KeyGen();
        expect(pk instanceof PointG1).to.be.true;
        expect(PointG1.one().mul(sk).isEqual(pk)).to.be.true;
    });
    it("Sign()", () => {
        const msg = encoder.encode("Hello");
        const { sk } = Schnorr.KeyGen();
        const { s, e } = Schnorr.Sign(sk, msg);
        expect(s instanceof Fr).to.be.true;
        expect(e instanceof Fr).to.be.true;
    });
    it("Verify()", () => {
        const msg = encoder.encode("Hello");
        const { sk, pk } = Schnorr.KeyGen();
        const sig = Schnorr.Sign(sk, msg);
        expect(Schnorr.Verify(pk, msg, sig)).to.be.true;
        const fakeMsg = encoder.encode("Fake");
        expect(Schnorr.Verify(pk, fakeMsg, sig)).to.be.false;
        const { s, e } = sig;
        const randomFr = new Fr().random();
        const fakeSig1 = { s, e: randomFr };
        expect(Schnorr.Verify(pk, msg, fakeSig1)).to.be.false;
        const fakeSig2 = { s: randomFr, e };
        expect(Schnorr.Verify(pk, msg, fakeSig2)).to.be.false;
    });
});
