import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DKG } from "../typechain";
import * as BLS from "../src/BLS";
import { Fr, initBN128, PointG1, PointG2 } from "../src/EC/bn128";
import { stringToBytes } from "../src/utils";
import { range } from "lodash";
import { arrayify, hexlify, solidityPack } from "ethers/lib/utils";

const STAKE = ethers.utils.parseEther("1");
const KEY_GEN_INTERVAL = 2;
const SECURITY_PARAMETER = 50n;
const DKG_AGGREGATION_EPOCH_LENGTH = 2;

describe("DKG", function () {
    let DKG: DKG;
    let signers: SignerWithAddress[];
    this.beforeAll(async () => {
        await initBN128();
        signers = await ethers.getSigners();
    });
    this.beforeEach(async () => {
        const Factory = await ethers.getContractFactory("DKG");
        DKG = await Factory.deploy(STAKE, KEY_GEN_INTERVAL, SECURITY_PARAMETER, DKG_AGGREGATION_EPOCH_LENGTH);
        await DKG.deployed();
    });
    it("Should have correct constants", async () => {
        expect(await DKG.STAKE()).to.equal(STAKE);
        expect(await DKG.KEY_GEN_INTERVAL()).to.equal(KEY_GEN_INTERVAL);
        expect(await DKG.SECURITY_PARAMETER()).to.equal(SECURITY_PARAMETER);
        expect(await DKG.DKG_AGGREGATION_EPOCH_LENGTH()).to.equal(DKG_AGGREGATION_EPOCH_LENGTH);
        expect(await DKG.isGenerating()).to.be.false;
        expect(await DKG.nodeThreshold()).to.equal(0);
        expect(await DKG.DKGRandomness()).to.equal(0);
        expect(await DKG.size()).to.equal(0);
        expect(await DKG.waitlistSize()).to.equal(0);
        expect(await DKG.deregistrationWaitlistSize()).to.equal(0);
        for (let i = 0; i < 4; i++) {
            expect(await DKG.masterPublicKey(i)).to.equal(0);
        }
    });
    it("valid node can join waitlist without error", async () => {
        const { pk } = BLS.KeyGen();
        await DKG.register("server1", pk.toBigInts(), { value: STAKE });
        expect(await DKG.size()).to.equal(0);
        expect(await DKG.waitlistSize()).to.equal(1);
    });
    it("node cannot join waitlist twice", async () => {
        const { pk } = BLS.KeyGen();
        await DKG.register("server1", pk.toBigInts(), { value: STAKE });
        await expect(DKG.register("server1", pk.toBigInts(), { value: STAKE })).to.be.revertedWith(
            "already in waitlist"
        );
    });
    it("nodes cannot register while isGenerating", async () => {
        // register node zero
        await DKG._registerNodeZero("server", BLS.KeyGen().pk.toBigInts(), { value: STAKE });

        await DKG._TEST_initDKG();
        const { pk } = BLS.KeyGen();
        await expect(DKG.connect(signers[1]).register("server1", pk.toBigInts(), { value: STAKE })).to.be.revertedWith(
            "isGenerating"
        );
    });
    it("DKG is initiated according to KEY_GEN_INTERVAL", async () => {
        const { pk } = BLS.KeyGen();
        // should not emit DKGInitiated
        await expect(DKG.register("server1", pk.toBigInts(), { value: STAKE })).not.to.emit(DKG, "DKGInitiated");
        // should emit DKGInitiated
        await expect(DKG.connect(signers[1]).register("server1", pk.toBigInts(), { value: STAKE })).to.emit(
            DKG,
            "DKGInitiated"
        );
        expect(await DKG.size()).to.equal(0);
        expect(await DKG.isGenerating()).to.be.true;
        expect(await DKG.nodeThreshold()).to.equal((SECURITY_PARAMETER * (2n - 1n)) / 100n);
    });
    it("nodes cannot deregister while isGenerating", async () => {
        const { pk } = BLS.KeyGen();
        await DKG.register("server1", pk.toBigInts(), { value: STAKE });
        await DKG.connect(signers[1]).register("server1", pk.toBigInts(), { value: STAKE });
        await expect(DKG.deregister()).to.be.revertedWith("isGenerating");
    });
    it("accepts a valid signature", async () => {
        const { sk, pk } = BLS.KeyGen();
        const message = stringToBytes("hello");
        const signature = BLS.Sign(sk, message);
        const isValid = await DKG.verifySignature(signature.toBigInts(), pk.toBigInts(), message);
        expect(isValid).to.be.true;
    });
    it("rejects invalid signature", async () => {
        const { sk, pk } = BLS.KeyGen();
        const message = stringToBytes("hello");
        const fakeMessage = stringToBytes("fake");
        const signature = BLS.Sign(sk, message);
        const isValid = await DKG.verifySignature(signature.toBigInts(), pk.toBigInts(), fakeMessage);
        expect(isValid).to.be.false;
    });
    it("_registerNodeZero works for deployer", async () => {
        const pk = BLS.KeyGen().pk.toBigInts();
        expect(await DKG.size()).to.equal(0);
        await DKG._registerNodeZero("server", pk, { value: STAKE });
        expect(await DKG.size()).to.equal(1);
        for (let i = 0; i < 4; i++) {
            expect(await DKG.masterPublicKey(i)).to.equal(pk[i]);
        }
    });
    it("_registerNodeZero reverts for non-owner", async () => {
        await expect(
            DKG.connect(signers[1])._registerNodeZero("server", BLS.KeyGen().pk.toBigInts(), { value: STAKE })
        ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("completes DKG successfully", async () => {
        // register node zero
        const { sk: MSK_zero, pk: MPK_zero } = BLS.KeyGen();
        await DKG._registerNodeZero("server", MPK_zero.toBigInts(), { value: STAKE });
        expect(await DKG.size()).to.equal(1);

        for (const i of range(1, KEY_GEN_INTERVAL + 1)) {
            const { pk } = BLS.KeyGen();
            await DKG.connect(signers[i]).register("server", pk.toBigInts(), { value: STAKE });
        }

        expect(await DKG.size()).to.equal(1);
        expect(await DKG.isGenerating()).to.be.true;
        expect(await DKG.DKGRandomness()).to.equal(0);

        // get the next block aggregator
        const aggregatorIndex = await DKG.getDKGAgregatorIndexByBlock((await ethers.provider.getBlockNumber()) + 1);
        expect(aggregatorIndex.toNumber() < signers.length).to.be.true;
        const aggregator = signers[aggregatorIndex.toNumber()];

        // get sessionId
        const sessionId = await DKG.lastSessionId();

        // let aggregator complete DKG
        const newMasterPublicKey = BLS.KeyGen().pk;
        const disqualified: string[] = [];
        const msg = arrayify(
            solidityPack(
                ["uint256[4]", "address[]", "uint256"],
                [newMasterPublicKey.toBigInts(), disqualified, sessionId]
            )
        );
        const signature = BLS.Sign(MSK_zero, msg);
        await expect(
            DKG.connect(aggregator).completeDKG(
                signature.toBigInts(),
                newMasterPublicKey.toBigInts(),
                disqualified,
                sessionId
            )
        ).to.emit(DKG, "DKGCompleted");

        expect(await DKG.size()).to.equal(KEY_GEN_INTERVAL + 1);
        expect(await DKG.isGenerating()).to.be.false;
        expect(await DKG.DKGRandomness()).to.equal(signature.toBigInts()[0]);
        // TODO: check the value of nodeThreshold

        // check new MPK is stored
        const newMPKInts = newMasterPublicKey.toBigInts();
        for (let i = 0; i < 4; i++) {
            expect(await DKG.masterPublicKey(i)).to.equal(newMPKInts[i]);
        }
    });
});
