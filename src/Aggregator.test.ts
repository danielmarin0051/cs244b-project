import * as BLS from "./BLS";
import { expect } from "chai";
import { AggregationNode } from "./common";
import { random, range } from "lodash";
import { Fr, initBN128, PointG1, PointG2 } from "./EC/bn128";
import { ACCOUNTS, randomSessionId } from "./test_utils";
import { AggregatorWrongMACAttacker } from "./AggregatorAttackers";
import { AggregationTopic, Aggregator, AggregatorConfig, SignatureResolver } from "./Aggregator";
import { arrayify } from "ethers/lib/utils";

const N = 3;
const BASE_PORT = 50051;
const REQUEST_TIMEOUT = 2;
const SYNC_DELTA_IN_SECONDS = 1;

function getNode(index: number) {
    const { pk } = BLS.KeyGen();
    const { sk: aggregationSK, pk: aggregationPK } = BLS.KeyGen();
    const node: AggregationNode = {
        pk, // doesn't matter
        index,
        server: `0.0.0.0:${BASE_PORT + index}`,
        ethAccount: ACCOUNTS[index], // doesn't matter
        aggregationPK,
        aggregationIndex: 0, // doesn't matter
    };
    return { node, aggregationSK };
}

function getConfig(
    node: AggregationNode,
    aggregationSK: Fr,
    nodes: AggregationNode[],
    signatureResolver: SignatureResolver
): AggregatorConfig {
    return {
        aggregationSK,
        nodes,
        port: BASE_PORT + node.index,
        signatureResolver,
        AGGREGATION_REQUEST_TIMEOUT: REQUEST_TIMEOUT,
        AGGREGATION_SYNC_DELTA_IN_SECONDS: SYNC_DELTA_IN_SECONDS,
    };
}

describe("Aggregator", function () {
    const nodes: AggregationNode[] = [];
    const keys: Fr[] = [];
    this.beforeAll(async () => {
        await initBN128();
        for (const index of range(N)) {
            const { node, aggregationSK } = getNode(index);
            nodes.push(node);
            keys.push(aggregationSK);
        }
    });
    it("works", async () => {
        this.timeout(10 * 1000);

        const message = "0x01";
        const aggregator = nodes[random(0, N - 1)];
        const aggregationId = randomSessionId();
        const topic = AggregationTopic.DKG;

        const aggregators: Aggregator[] = [];
        const expectedSignatures: PointG1[] = [];

        for (const node of nodes) {
            const signatureResolver: SignatureResolver = async (aggregationId, topic) => {
                const signature = BLS.Sign(keys[node.index], arrayify(message));
                expectedSignatures[node.index] = signature;
                return { message, signature, error: null };
            };
            aggregators[node.index] = new Aggregator(getConfig(node, keys[node.index], nodes, signatureResolver));
        }

        const [signatures] = await Promise.all([
            // start aggregator
            aggregators[aggregator.index].runAggregation(aggregationId, message, topic),
            // start aggregatorServers
            ...nodes.map((node) => aggregators[node.index].startAggregationServer(aggregator)),
        ]);

        await Promise.all(nodes.map((node) => aggregators[node.index].stopAggregationServer()));

        // check
        for (const index of Object.keys(expectedSignatures).map(Number)) {
            const signature = signatures[index];
            expect(signature).to.not.equal(null);
            if (signature === null) throw new Error();
            expect(signature.isEqual(expectedSignatures[index])).to.be.true;
        }
    });
    it("works correctly for WrongMACAttacker", async function () {
        this.timeout(10 * 1000);

        const message = "0x01";
        const aggregator = nodes[random(0, N - 1)];
        const aggregationId = randomSessionId();
        const attackerIndex = random(0, N - 1);

        const topic = AggregationTopic.DKG;
        const aggregators: Aggregator[] = [];
        const expectedSignatures: Record<number, PointG1 | null> = {};

        for (const node of nodes) {
            const signatureResolver: SignatureResolver = async (aggregationId, topic) => {
                const signature = BLS.Sign(keys[node.index], arrayify(message));
                expectedSignatures[node.index] = node.index === attackerIndex ? null : signature;
                return { message, signature, error: null };
            };
            const config = getConfig(node, keys[node.index], nodes, signatureResolver);
            if (node.index === attackerIndex) {
                aggregators[node.index] = new AggregatorWrongMACAttacker(config);
            } else {
                aggregators[node.index] = new Aggregator(config);
            }
        }

        const [signatures] = await Promise.all([
            // start aggregator
            aggregators[aggregator.index].runAggregation(aggregationId, message, topic),
            // start aggregatorServers
            ...nodes.map((node) => aggregators[node.index].startAggregationServer(aggregator)),
        ]);

        await Promise.all(nodes.map((node) => aggregators[node.index].stopAggregationServer()));

        // check
        for (const index of Object.keys(expectedSignatures).map(Number)) {
            // const signature = signatures[index];
            // if (index === attackerIndex) {
            //     expect(signature).to.equal(null);
            // } else {
            //     expect(signature).to.not.equal(null);
            //     if (signature === null) throw new Error();
            //     expect(signature.isEqual(expectedSignatures[index])).to.be.true;
            // }
            // const signature = signatures[index];
            // expect(signature).to.not.equal(null);
            // if (signature === null) throw new Error();
            // expect(signature.isEqual(expectedSignatures[index])).to.be.true;
            const expectedSignature = expectedSignatures[index];
            const signature = signatures[index];
            if (expectedSignature === null) {
                expect(signature).to.equal(null);
            } else {
                expect(signature).to.not.equal(null);
                if (signature === null) throw new Error(); // for Typescript
                expect(signature.isEqual(expectedSignature)).to.be.true;
            }
        }
    });
    it("works correctly for attacker with wrong signature", async function () {
        this.timeout(10 * 1000);

        const message = "0x01";
        const fakeMessage = "0x02";
        const aggregator = nodes[random(0, N - 1)];
        const aggregationId = randomSessionId();
        const attackerIndex = random(0, N - 1);

        const topic = AggregationTopic.DKG;
        const aggregators: Aggregator[] = [];
        const expectedSignatures: Record<number, PointG1 | null> = {};

        for (const node of nodes) {
            const signatureResolver: SignatureResolver = async (aggregationId, topic) => {
                const iAmTheAttacker = node.index === attackerIndex;
                const signature = BLS.Sign(keys[node.index], arrayify(iAmTheAttacker ? fakeMessage : message));
                expectedSignatures[node.index] = iAmTheAttacker ? null : signature;
                return { message, signature, error: null };
            };
            const config = getConfig(node, keys[node.index], nodes, signatureResolver);
            aggregators[node.index] = new Aggregator(config);
        }

        const [signatures] = await Promise.all([
            // start aggregator
            aggregators[aggregator.index].runAggregation(aggregationId, message, topic),
            // start aggregatorServers
            ...nodes.map((node) => aggregators[node.index].startAggregationServer(aggregator)),
        ]);

        await Promise.all(nodes.map((node) => aggregators[node.index].stopAggregationServer()));

        // check
        for (const index of Object.keys(expectedSignatures).map(Number)) {
            const expectedSignature = expectedSignatures[index];
            const signature = signatures[index];
            if (expectedSignature === null) {
                expect(signature).to.equal(expectedSignature);
            } else {
                expect(signature).to.not.equal(null);
                if (signature === null) throw new Error(); // for Typescript
                expect(signature.isEqual(expectedSignature)).to.be.true;
            }
        }
    });
});
