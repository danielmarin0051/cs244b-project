import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Nexus, Nexus__factory } from "../typechain";

const ORIGIN_CHAIN_ID = 1;
const INITIAL_ROOT = "0x27ae5ba08d7291c96c8cbddcc148bf48a6d68c7974b94356f53754ef6171d757";
const abiCoder = ethers.utils.defaultAbiCoder;

describe("Nexus", function () {
    let signers: SignerWithAddress[];
    let Nexus: Nexus;
    this.beforeAll(async () => {
        signers = await ethers.getSigners();
    });
    this.beforeEach(async () => {
        Nexus = await new Nexus__factory(signers[0]).deploy(ORIGIN_CHAIN_ID);
    });
    it("Has correct initial values", async function () {
        expect(await Nexus.ORIGIN_CHAIN_ID()).to.equal(ORIGIN_CHAIN_ID);
        expect(await Nexus.root()).to.equal(INITIAL_ROOT);
    });
    it("Should emit an event", async function () {
        const chainId = 2;
        const recipient = signers[1].address;
        const message = "0x01";
        await expect(Nexus.sendMessage(chainId, recipient, message)).to.emit(Nexus, "MessageSent");
    });
    it("Should update root", async () => {
        const oldRoot = await Nexus.root();
        const toChainId = 2;
        const recipient = signers[1].address;
        const message = "0x01";
        await Nexus.sendMessage(toChainId, recipient, message);
        const newRoot = await Nexus.root();
        expect(newRoot).to.not.be.equal(oldRoot);
    });
    it("Should emit an event on receipt", async () => {
        const origin = 2;
        const destination = 1;
        const sender = signers[0].address;
        const recepient = signers[1].address;
        const nonce = 1;
        const message = "0x01";

        const packet = abiCoder.encode(
            ["uint", "uint", "address", "address", "uint", "bytes"],
            [origin, destination, sender, recepient, nonce, message]
        );

        const branch = new Array<string>(32).fill(INITIAL_ROOT);
        const leafIndex = 1;

        const proof = abiCoder.encode(["bytes32[32]", "uint"], [branch, leafIndex]);

        await expect(Nexus.receiveMessage(packet, proof)).to.emit(Nexus, "MessageReceived");
    });
});
