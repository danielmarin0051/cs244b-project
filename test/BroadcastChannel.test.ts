import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { hexlify } from "ethers/lib/utils";
import { BroadcastChannel } from "../typechain";

describe("BroadcastChannel", function () {
    let deployer: SignerWithAddress;
    let BroadcastChannel: BroadcastChannel;
    this.beforeAll(async () => {
        [deployer] = await ethers.getSigners();
    });
    this.beforeEach(async () => {
        const Factory = await ethers.getContractFactory("BroadcastChannel");
        BroadcastChannel = await Factory.deploy();
        await BroadcastChannel.deployed();
    });
    it("Should broadcast an event", async function () {
        const sessionId = 1;
        const topic = 3;
        const message = Buffer.from("hello");
        await expect(BroadcastChannel.broadcast(sessionId, topic, message))
            .to.emit(BroadcastChannel, "Broadcast")
            .withArgs(deployer.address, sessionId, topic, hexlify(message));

        const filter = BroadcastChannel.filters.Broadcast();
        const logs = await BroadcastChannel.queryFilter(filter);

        expect(logs.length).to.equal(1);
    });
});
