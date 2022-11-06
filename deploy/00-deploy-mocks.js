const { developmentChains } = require("../helper-hardhat-config")

// constructor args for VRFCoordinator
const BASE_FEE = ethers.utils.parseEther("0.25") // Link is oracle gas btw. 0.25 is the min. it cost 0.25 Link per request
const GAS_PRICE_LINK = 1e9 // 100000000 // link per gas. calculated value based on the gas price of the chain.
// calculated because Chainlink Nodes pay the gas fees to give us randomness & do external execution
// So they price of requests change based on the price of gas (to match increase or decrease in price of ETH)

module.exports = async function ({ getNamedAccounts, deployments }) {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    // const chainId = network.config.chainId  // cuz we only wann deploy this on local network/development chains
    const args = [BASE_FEE, GAS_PRICE_LINK]

    if (developmentChains.includes(network.name)) {
        log("Local network detected! Deploying mocks...")
        // deploy a mock vrfcoordinator... (located in contracts then test)
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            log: true,
            args: args,
        })
        log("Mocks Deployed!")
        log("---------------------------------------") 
    }
}

module.exports.tags = ["all", "mocks"]