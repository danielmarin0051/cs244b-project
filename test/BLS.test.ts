import { expect } from "chai";
import { ethers } from "hardhat";
import { TestBLS } from "../typechain/TestBLS";
import * as BLS from "../src/BLS";
import { stringToBytes } from "../src/utils";
import { initBN128, PointG1, PointG2 } from "../src/EC/bn128";

describe("BLS", function () {
    let TestBLS: TestBLS;
    this.beforeAll(async () => {
        await initBN128();
    });
    this.beforeEach(async () => {
        TestBLS = await (await ethers.getContractFactory("TestBLS")).deploy();
    });
    it("hash to point works", async () => {
        const msg = stringToBytes("hello");
        const expectedMsgPoint = BLS.HashToPointG1(msg).toBigInts();
        const msgPoint = await TestBLS.hashToPoint(msg);

        expect(msgPoint[0]).to.equal(expectedMsgPoint[0]);
        expect(msgPoint[1]).to.equal(expectedMsgPoint[1]);
    });
    it("accepts valid signature", async function () {
        const { sk, pk } = BLS.KeyGen();
        const msg = stringToBytes("hello");
        const sig = BLS.Sign(sk, msg);
        const isValid = await TestBLS.verify(sig.toBigInts(), pk.toBigInts(), msg);
        expect(isValid).to.be.true;
    });
    it("rejects signature with invalid pk", async function () {
        const { sk } = BLS.KeyGen();
        const { pk } = BLS.KeyGen();
        const msg = stringToBytes("hello");
        const sig = BLS.Sign(sk, msg);
        const isValid = await TestBLS.verify(sig.toBigInts(), pk.toBigInts(), msg);
        expect(isValid).to.be.false;
    });
    it("rejects signature with invalid pk", async function () {
        const { sk } = BLS.KeyGen();
        const { pk } = BLS.KeyGen();
        const msg = stringToBytes("hello");
        const sig = BLS.Sign(sk, msg);
        const isValid = await TestBLS.verify(sig.toBigInts(), pk.toBigInts(), msg);
        expect(isValid).to.be.false;
    });
    it("rejects invalid signature", async function () {
        const { sk } = BLS.KeyGen();
        const { pk } = BLS.KeyGen();
        const msg = stringToBytes("hello");
        const sig = BLS.Sign(sk, msg);
        const fakeSig = sig.add(PointG1.one());
        const isValid = await TestBLS.verify(fakeSig.toBigInts(), pk.toBigInts(), msg);
        expect(isValid).to.be.false;
    });
});
