// To test this
// 1. Get our SubId for Chainlink VRF
// 2. Deploy our contract using the SubId
// 3. Register the contract with Chainlink VRF & it's subId
// 4. Register the contract with Chainlink Keepers/ automation
// 5. Run Staging tests

const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
        let raffle, raffleEntranceFee, deployer

        beforeEach(async function () {
            deployer = (await getNamedAccounts()).deployer
            raffle = await ethers.getContract("Raffle", deployer) // connect it to deployer
            raffleEntranceFee = await raffle.getEntranceFee()
        })

        describe("fulfillRandomWords", function () {
            it("works with live Chainlink Automation and Chainlink VRF, we get a random winner", async function() {
                // enter the raffle
                const startingTimeStamp = await raffle.getLastTimeStamp()
                const accounts = await ethers.getSigners()

                await new Promise(async (resolve, reject) => {
                    // setup listener before we enter the raffle
                    // Just in case the blockchain moves REALLY fast
                    raffle.once("WinnerPicked", async () => {
                        console.log("WinnerPicked event fired!")
                        try {
                            // add our asserts here
                            const recentWinner = await raffle.getRecentWinner()
                            const raffleState = await raffle.getRaffleState()
                            const winnerEndingBalance = await accounts[0].getBalance()
                            const endingTimeStamp = await raffle.getLastTimeStamp()

                            await expect(raffle.getPlayer(0)).to.be.reverted
                            assert.equal(recentWinner.toString(), accounts[0].address)
                            assert.equal(raffleState, 0)
                            // note starting balance was definied after enter raffle
                            assert.equal(winnerEndingBalance.toString(), winnerStartingBalance.add(raffleEntranceFee).toString())
                            assert(endingTimeStamp > startingTimeStamp)
                            resolve()

                        } catch (error) {
                            console.log(error)
                            reject(error)
                        }
                    })
                    // Then entering the raffle
                    await raffle.enterRaffle({ value: raffleEntranceFee })
                    const winnerStartingBalance = await accounts[0].getBalance()

                    // and this code WONT complete until our listener has finished listening!
                })

            })
        })
    })