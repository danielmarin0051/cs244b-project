import { expect } from "chai";
import * as EthSchnorr from "./EthSchnorr";
import { Fr, PointG1, initSecp256k1 } from "./EC/secp256k1";
import { stringToBytes } from "./utils";
import { getAddress } from "ethers/lib/utils";

const Q = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HalfQ = (Q >> 1n) + 1n;

describe("EthSchnorr", function () {
    this.beforeAll(async () => {
        await initSecp256k1();
    });
    it("KeyGen()", () => {
        const { sk, pk } = EthSchnorr.KeyGen();
        expect(pk instanceof PointG1).to.be.true;
        expect(PointG1.one().mul(sk).isEqual(pk)).to.be.true;
        expect(pk.getX().toBigInt() < HalfQ, "x coordinate of public key must be less than half group order.").to.be
            .true;
    });
    it("Sign()", () => {
        const msg = stringToBytes("Hello");
        const { sk } = EthSchnorr.KeyGen();
        const { sig, e, nonceTimesGeneratorAddress } = EthSchnorr.Sign(sk, msg);
        expect(sig instanceof Fr).to.be.true;
        expect(e instanceof Fr).to.be.true;
        expect(getAddress(nonceTimesGeneratorAddress)).to.not.throw;
    });
    it("Verify()", () => {
        const msg = stringToBytes("Hello");
        const { sk, pk } = EthSchnorr.KeyGen();
        const signature = EthSchnorr.Sign(sk, msg);
        expect(EthSchnorr.Verify(pk, msg, signature)).to.be.true;
        const fakeMsg = stringToBytes("Fake");
        expect(EthSchnorr.Verify(pk, fakeMsg, signature)).to.be.false;
    });
});
