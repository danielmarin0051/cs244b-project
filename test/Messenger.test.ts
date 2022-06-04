import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Messenger, Messenger__factory } from "../typechain";

const ORIGIN_CHAIN_ID = 1;
const INITIAL_ROOT = "0x27ae5ba08d7291c96c8cbddcc148bf48a6d68c7974b94356f53754ef6171d757";

describe("Messenger", function () {
    let signers: SignerWithAddress[];
    let Messenger: Messenger;
    this.beforeAll(async () => {
        signers = await ethers.getSigners();
    });
    this.beforeEach(async () => {
        Messenger = await new Messenger__factory(signers[0]).deploy(ORIGIN_CHAIN_ID);
    });
    it("Has correct initial values", async function () {
        expect(await Messenger.ORIGIN_CHAIN_ID()).to.equal(ORIGIN_CHAIN_ID);
        expect(await Messenger.root()).to.equal(INITIAL_ROOT);
    });
    it("Should emit an event", async function () {
        const chainId = 2;
        const recipient = signers[1].address;
        const message = "0x01";
        await expect(Messenger.sendMessage(chainId, recipient, message)).to.emit(Messenger, "MessageSent");
    });
    it("Should update root", async () => {
        const oldRoot = await Messenger.root();
        const chainId = 2;
        const recipient = signers[1].address;
        const message = "0x01";
        await Messenger.sendMessage(chainId, recipient, message);
        const newRoot = await Messenger.root();
        expect(newRoot).to.not.be.equal(oldRoot);
    });
});
