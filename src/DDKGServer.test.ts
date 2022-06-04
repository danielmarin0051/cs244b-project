import { expect } from "chai";
import { range } from "lodash";
import { Fr, initBN128, PointG2 } from "./EC/bn128";
import { Node } from "./common";
import { DDKGServer, DDKGServerConfig } from "./DDKGServer";
import { randomSessionId } from "./test_utils";

const N = 3;
const REQUEST_TIMEOUT_IN_SECONDS = 2;
const BASE_PORT = 50051;

function getConfigForNode(node: Node, sk: Fr, nodes: Node[], sessionId: number): DDKGServerConfig {
    return {
        sk,
        index: node.index,
        nodes: nodes,
        port: BASE_PORT + node.index,
        REQUEST_TIMEOUT_IN_SECONDS,
        sessionId,
    };
}

function getNode(index: number): { node: Node; sk: Fr } {
    const sk = new Fr().random();
    const pk = PointG2.one().mul(sk);
    const node: Node = {
        pk,
        index,
        server: `0.0.0.0:${BASE_PORT + index}`,
        ethAccount: "",
        aggregationPK: null,
        aggregationIndex: null,
    };
    return { node, sk };
}

describe("DDKGServer", function () {
    let nodes: Node[] = [];
    const keys: Record<number, Fr> = {};
    this.beforeAll(async () => {
        await initBN128();
        for (const index of range(N)) {
            const { node, sk } = getNode(index);
            nodes.push(node);
            keys[index] = sk;
        }
    });
    it("works for multiple", async () => {
        const sessionId = randomSessionId();
        const servers: Record<number, DDKGServer> = {};

        const allReceivedShares: Record<number, Record<number, Fr>> = {};
        nodes.forEach((node) => (allReceivedShares[node.index] = {}));

        // start all servers
        await Promise.all(
            nodes.map(async (node) => {
                servers[node.index] = new DDKGServer(getConfigForNode(node, keys[node.index], nodes, sessionId));
                await servers[node.index].start();
            })
        );

        // send all shares
        await Promise.all(
            nodes.map(async (node_i) => {
                await Promise.all(
                    nodes.map(async (node_j) => {
                        const share_ij = new Fr(node_i.index ** node_j.index);
                        allReceivedShares[node_j.index][node_i.index] = share_ij;
                        await servers[node_i.index].sendShare(node_j, share_ij);
                    })
                );
            })
        );

        for (const node of nodes) {
            await servers[node.index].stop();
            const receivedShares = servers[node.index].getReceivedShares();
            for (const j of Object.keys(allReceivedShares[node.index]).map(Number)) {
                expect(receivedShares[j]).to.not.equal(undefined);
                expect(receivedShares[j].isEqual(allReceivedShares[node.index][j])).to.be.true;
            }
        }
    });
});
