import { ethers } from "hardhat";

async function main() {
    const Factory = await ethers.getContractFactory("BroadcastChannel");
    const BroadcastChannel = await Factory.deploy();
    await BroadcastChannel.deployed();
    console.log("BroadcastChannel deployed to:", BroadcastChannel.address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
