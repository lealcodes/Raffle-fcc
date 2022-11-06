// we only want to do unit test on development chain (local)

const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
        let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval
        const chainId = network.config.chainId

        beforeEach(async function () {
            deployer = (await getNamedAccounts()).deployer
            await deployments.fixture(["all"]) // deploying mock and raffle
            raffle = await ethers.getContract("Raffle", deployer) // connect it to deployer
            vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
            raffleEntranceFee = await raffle.getEntranceFee()
            interval = await raffle.getInterval()
        })

        describe("constructor", function () {
            it("initializes the raffle correctly", async function () {
                // ideally we make our test have just 1 assert per "it"
                const raffleState = await raffle.getRaffleState()
                assert.equal(raffleState.toString(), "0")
                assert.equal(interval.toString(), networkConfig[chainId]["interval"])
            })
        })

        describe("enterRaffle", function () {
            it("reverts when you don't pay enough", async function () {
                // not sending any value but calling it so should be reverted
                await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__NotEnoughETHEntered")
            })
            it("record players when they enter", async function () {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                const playerFromContract = await raffle.getPlayer(0)
                assert.equal(playerFromContract, deployer)
            })
            it("emits event on enter", async function () {
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(raffle, "RaffleEnter")
            })
            it("doesnt allow entrance when raffle is calculating", async function () {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                // need to make checkUpkeep be true so we can pretend to be chainlink keeper and call performUpkeep so
                // raffle state changes to calculating
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                // could also do
                // await network.provider.request({method: "evm_mine", params: []})
                // now pretend to be chainlink keeper
                await raffle.performUpkeep([]) // passing emty calldata
                await expect(raffle.enterRaffle({value: raffleEntranceFee})).to.be.revertedWith("Raffle__NotOpen")
            })
        })
        describe("checkUpkeep", function(){
            it("returns false if people haven't sent any ETH", async function(){
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                // since checkUpkeep is a public function it kicks off a transaction when you call it
                // if it was public view, it wouldnt, it would just return
                // we don't wanna send a transaction we just wanna check upkeepNeeded, so we can use call static
                // which simulates calling this transaction to see what it would look like
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                assert(!upkeepNeeded)
            })
            it("returns false if raffle isn't open", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                await raffle.performUpkeep([]) // note: could also do "0x" instead of []
                const raffleState = await raffle.getRaffleState()
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                assert.equal(raffleState.toString(), "1")
                assert.equal(upkeepNeeded, false)
            })
            it("returns false if enough time hasn't passed", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(!upkeepNeeded)
            })
            it("returns true if enough time has passed, has players, eth, and is open", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(upkeepNeeded)
            })
        })
        describe("performUpkeep", function(){
            it("it can only run if checkUpkeep is true", async function(){
                await raffle.enterRaffle({value: raffleEntranceFee})
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                const tx = await raffle.performUpkeep([])
                // if calling the function errors out the assert tx will be failed
                assert(tx)
            })
            it("reverts when checkupkeep is false", async function() {
                await expect(raffle.performUpkeep([])).to.be.revertedWith("Raffle__UpkeepNotNeeded")
            })
            it("updates the raffle state, emits an event, and calls the vrf coordinator", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const txResponse = await raffle.performUpkeep([])
                const txReceipt = await txResponse.wait(1)
                // getting requestId from event we emit while calling the function performUpkeep
                // we use index 1 because the first emitted event (index 0) is done within Vrf coordinator Mock code
                // so us emitting this second one is reduntant but whatever
                const requestId = txReceipt.events[1].args.requestId
                const raffleState = await raffle.getRaffleState()
                assert(requestId.toNumber() > 0)
                assert(raffleState == 1)
            })
        })
        describe("fullfillRandomWords", function(){
            beforeEach(async function () {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() +1])
                await network.provider.send("evm_mine", [])
            })
            it("can only be called after performUpkeep", async function () {
                // fulfillRandomWords should only work w a valid subscriptionId
                // looking at VrfCoordinatorMock u can see that it reutns the error shown below if non existent subscriptionId
                // this function is waht chainlink node actually calls and inside the function it calls another contract that does random number verification
                // no subscriptionId should work here because performUpkeep hasnt been called
                await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)).to.be.revertedWith("nonexistent request")
                await expect(vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)).to.be.revertedWith("nonexistent request")
            })
            // big test coming, for teaching purposes, maybe should prob break it up
            it("picks a winner, resets the lottery, and sends money", async function () {
                // gonna make more accounts join the lottery besides deployer who is already in
                // us ethers fake accounts
                const accounts = await ethers.getSigners()
                const additionalEntrants = 3
                const startingAccountIndex = 1 // since deployer = 0

                for(let i = startingAccountIndex; i < startingAccountIndex + additionalEntrants; i++){
                    const accountConnectedRaffle = raffle.connect(accounts[i])
                    await accountConnectedRaffle.enterRaffle({value: raffleEntranceFee})
                }

                const startingTimeStamp = await raffle.getLastTimeStamp()

                // we want to performUpkeep (which mocks being chainlink keepers/automation)
                // which will kick off fulfillRandomWords (mock being chainlink VRF)
                // for local we dont HAVE to but we will wait for the fulfillRandomWords to be called
                // so we need to set up a listener to listen for the event being emitted
                // dont want test to finish before listener is done listening so we create a new promise
                await new Promise(async (resolve, reject) => {
                    // saying once event WinnerPicked is emitted so some stuff
                    // we dont wanna wait forever so put a timeout, add mocha to hardhat config
                    raffle.once("WinnerPicked", async () => {
                        console.log("Found the Event!") // so now jump into try catch
                        // like to put inside a try and catch in case a function or something goes wrong
                        try {
                            const recentWinner = await raffle.getRecentWinner()
                            console.log(recentWinner)
                            console.log(accounts[0].address)
                            console.log(accounts[1].address)
                            console.log(accounts[2].address)
                            console.log(accounts[3].address)
                            const raffleState = await raffle.getRaffleState()
                            const endingTimeStamp = await raffle.getLastTimeStamp()
                            const numPlayers = await raffle.getNumberOfPlayers()
                            const winnerEndingBalance = await accounts[1].getBalance()
                            assert.equal(numPlayers.toString(), "0")
                            assert.equal(raffleState.toString(), "0")
                            assert(endingTimeStamp > startingTimeStamp)

                            assert.equal(winnerEndingBalance.toString(), winnerStartingBalance.add(raffleEntranceFee.mul(additionalEntrants).add(raffleEntranceFee).toString()))
                            resolve()
                        } catch (e) {
                            reject(e)
                        }
                    })
                    // now we write our code in here inside the promise cuz if outside then it will never reach it, it will just be waitnig for the event
                    // so put it within promise but outside the raffle above
                    // below, we will fire the event, and the listener will pick it up, and resolve
                    const tx = await raffle.performUpkeep([])
                    const txReceipt = await tx.wait(1)
                    const winnerStartingBalance = await accounts[1].getBalance()
                    //console.log(txReceipt.event[1].args.requestId)
                    await vrfCoordinatorV2Mock.fulfillRandomWords(txReceipt.events[1].args.requestId, raffle.address)
                    // couldve put assert's down here for local but on a testnet, we dont known when event will be fired since
                    // we use chainlink automation/keepers, so that's why we set up a listener 
                })
            })
        })
    })