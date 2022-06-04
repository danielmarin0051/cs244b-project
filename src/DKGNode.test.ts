import lodash, { range } from "lodash";
import { expect } from "chai";
import { initBN128, PointG2, Fr, lagrangeInterpolation } from "./EC/bn128";
import { DKGNode, executeDKGEndToEnd } from "./DKGNode";
import { DKGNodeAttackerWrongShare } from "./DKGNodeAttackers";

describe("DKGNode", function () {
    this.beforeAll(async () => {
        await initBN128();
    });
    it("Executes end-to-end successfully when all honest", () => {
        const [n, t] = [5, 3];
        const nodes = range(n).map((index) => new DKGNode(n, t, index));
        executeDKGEndToEnd(nodes);
        const allNodeIndices = new Set(range(n));
        // expect all nodes agree on QUAL
        expect(nodes.every((node) => lodash.isEqual(node.QUAL, allNodeIndices))).to.be.true;
        // expect all mpk !== G1Zero
        expect(nodes.every((node) => !node.mpk.isEqual(PointG2.zero()))).to.be.true;
        // expect all mpk are equal
        expect(nodes.every((node) => node.mpk.isEqual(nodes[0].mpk))).to.be.true;

        // expect all mskShares to be distinct
        for (const node_i of nodes) {
            for (const node_j of nodes) {
                if (node_i.index !== node_j.index) {
                    expect(node_i.mskShare.isEqual(node_j.mskShare)).to.be.false;
                }
            }
        }

        expect(mskCanBeRecovered(nodes, t)).to.be.true;

        expect(lodash.isEqual(Object.keys(nodes[0].QUALPublicKeys).map(Number), range(n)));
        expect(nodes.every((node) => nodes[0].QUALPublicKeys[node.index].isEqual(PointG2.one().mul(node.mskShare))));
    });
    it("DKGNodeAttackerWrongShare", () => {
        const [n, t] = [5, 3];
        const honestNodes = range(1, n).map((index) => new DKGNode(n, t, index));
        const nodes = [new DKGNodeAttackerWrongShare(n, t, 0), ...honestNodes];

        executeDKGEndToEnd(nodes);
        const allHonestNodesIndices = new Set(range(1, n));
        expect(honestNodes.every((node) => lodash.isEqual(node.QUAL, allHonestNodesIndices))).to.be.true;
        expect(honestNodes[0].mpk.isEqual(PointG2.zero())).to.be.false;
        expect(honestNodes.every((node) => node.mpk.isEqual(honestNodes[0].mpk)));
        expect(mskCanBeRecovered(honestNodes, t)).to.be.true;
        expect(mskCanBeRecovered(nodes.slice(0, t + 1), t)).to.be.false;

        expect(lodash.isEqual(Object.keys(honestNodes[0].QUALPublicKeys).map(Number), range(1, n)));
        expect(
            honestNodes.every((node) =>
                honestNodes[0].QUALPublicKeys[node.index].isEqual(PointG2.one().mul(node.mskShare))
            )
        );
    });
});

function mskCanBeRecovered(QUAL_Nodes: DKGNode[], t: number): boolean {
    if (QUAL_Nodes.length < t + 1) throw new Error("QUAL_Nodes.length < t + 1");
    const nodes = lodash.sampleSize(QUAL_Nodes, t + 1);
    const points: [Fr, Fr][] = nodes.map((node) => [new Fr(node.index + 1), node.mskShare]);
    const msk = lagrangeInterpolation(points)(Fr.zero());
    const expectedMsk = QUAL_Nodes.reduce<Fr>((sum, node) => sum.add(node.coeffs[0]), Fr.zero());
    return msk.isEqual(expectedMsk);
}
