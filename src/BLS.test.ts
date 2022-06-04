import * as BLS from "./bls";
import { expect } from "chai";
import { initBN128, Fr, PointG1, PointG2 } from "./EC/bn128";
import { range } from "lodash";
import { DKGNode, executeDKGEndToEnd } from "./DKGNode";

const encoder = new TextEncoder();

describe("BLS", function () {
    this.beforeAll(async () => {
        await initBN128();
    });
    it("KeyGen()", () => {
        const { sk, pk } = BLS.KeyGen();
        expect(pk instanceof PointG2).to.be.true;
        expect(PointG2.one().mul(sk).isEqual(pk)).to.be.true;
    });
    it("Sign()", () => {
        const msg = encoder.encode("Hello");
        const { sk } = BLS.KeyGen();
        const sig = BLS.Sign(sk, msg);
        expect(sig instanceof PointG1).to.be.true;
        expect(sig.n.isValidOrder()).to.be.true;
        expect(sig.n.isValid());
    });
    it("Verify()", () => {
        const msg = encoder.encode("Hello");
        const { sk, pk } = BLS.KeyGen();
        const sig = BLS.Sign(sk, msg);
        expect(BLS.Verify(pk, msg, sig)).to.be.true;
        const fakeMsg = encoder.encode("Fake");
        expect(BLS.Verify(pk, fakeMsg, sig)).to.be.false;
        const fakeSig = PointG1.one().mul(new Fr(2));
        expect(BLS.Verify(pk, msg, fakeSig)).to.be.false;
    });
    it("AggregateThresholdSignatures()", async () => {
        const [n, t] = [3, 1];
        const nodes = range(n).map((index) => new DKGNode(n, t, index));
        executeDKGEndToEnd(nodes);

        const msg = encoder.encode("Hello");
        const signatures = nodes.map((node) => BLS.Sign(node.mskShare, msg));
        const xPoints = nodes.map((node) => new Fr(node.index + 1));
        const pks = nodes.map((node) => nodes[0].QUALPublicKeys[node.index]);
        expect(xPoints.length).to.equal(signatures.length);
        expect(xPoints.length).to.equal(pks.length);
        for (const node of nodes) {
            expect(PointG2.one().mul(node.mskShare).isEqual(nodes[0].QUALPublicKeys[node.index])).to.be.true;
            expect(BLS.Verify(pks[node.index], msg, signatures[node.index]));
        }
        const aggSig = BLS.AggregateThresholdSignatures(signatures, xPoints);
        expect(BLS.Verify(nodes[0].mpk, msg, aggSig));
    });
});
