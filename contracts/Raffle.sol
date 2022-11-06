// Raffle
// Enter the lottery (paying some amount)\
// Pick a random winner (verifiably random)
// Winner to be selected every X minutes -> completly automated
// Chainlink Oracle -> Randomness, Automated Execution (Chainlink Keepers)

// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

// to make our contracte VRFeble we need to import the chainlink code
import '@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol';
// this interface let's introduce that VRF state variable and more
import '@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol';
// chainlink keepers which is now called chainlink automation
import "@chainlink/contracts/src/v0.8/AutomationCompatible.sol";


error Raffle__NotEnoughETHEntered();
error Raffle__TransferFailed();
error Raffle__NotOpen();
error Raffle__UpkeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 raffleState);

// this "is whatever" means that we are inherinting this VRF consumer so our contract can use it
contract Raffle is VRFConsumerBaseV2, AutomationCompatibleInterface {
    /* Type declarations */
    enum RaffleState {
        OPEN,
        CALCULATING
    } // with this enum we are really secretly creating a uint256 0 = OPEN, 1 = CALCULATING

    /* State Variables */
    uint256 private immutable i_entranceFee;
    address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_gasLane;
    uint64 private immutable i_subscriptionId;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private immutable i_callbackGasLimit;
    uint32 private constant NUM_WORDS = 1;

    // Lottery Variable
    address private s_recentWinner;
    // bool private s_isOpen; // to true if we are open
    // we use enum instead to keep track of multiple things, pending, open, closed
    RaffleState private s_raffleState;
    uint256 private s_lastTimeStamp;
    uint256 private immutable i_interval; // how long we want betwen each lottery run

    /* Events */
    event RaffleEnter(address indexed player);
    event RequestedRaffleWinner(uint256 indexed requestId);
    event WinnerPicked(address indexed winner);

    // vrfCoordinatorV2 is the address of the contract that verifies the random number
    // VRFConsumerBaseV2 is also a constructor (so it launches when we deploy so we can get a random number)
    // since our constructor asks for a contract address, we are gonna have to deploy a mock for it, for local hosting
    constructor(address vrfCoordinatorV2, uint256 entranceFee, bytes32 gasLane, uint64 subscriptionId, uint32 callbackGasLimit, uint256 interval) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_entranceFee = entranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_gasLane = gasLane;
        i_subscriptionId = subscriptionId;
        i_callbackGasLimit = callbackGasLimit;
        s_raffleState = RaffleState.OPEN; // couldve also done RaffleState(0);
        s_lastTimeStamp = block.timestamp; // block timestamp is globally available variable from solidity
        i_interval = interval;
    }

    function enterRaffle() payable public {
        // require (msg.value > i_entranceFee, "Not enough ETH!")
        // however let's do a custom error since its more gas efficient because it doesnt need to store that string above
        if(msg.value < i_entranceFee){
            revert Raffle__NotEnoughETHEntered();
        }
        if (s_raffleState != RaffleState.OPEN){
            revert Raffle__NotOpen();
        }
        // s_players.push(msg.sender); doesnt work because msg.sender is not payable so we need to make it payable
        s_players.push(payable(msg.sender));
        // Emit an event when we update a dynamic array or mapping
        // Named events with the function name reversed (good practice)
        emit RaffleEnter(msg.sender);
    }

    /**
     * @dev This is the function that the Chainlink Keeper nodes call
     * they look for the `upkeepNeeded` to return true
     * the following should be true in order to return true:
     * 1. Our time interval should have passed
     * 2. The lottery should have at least 1 player, and have some ETH
     * 3. Our subscription is funded with LINK
     * 4. The lottery should be in an "open" state.
     */
    function checkUpkeep(bytes memory /* checkData */) public view override returns (bool upkeepNeeded, bytes memory /* performData */ ){
        bool isOpen = (RaffleState.OPEN == s_raffleState);
        bool timePassed = ((block.timestamp - s_lastTimeStamp) > i_interval);
        bool hasPlayers = (s_players.length > 0);
        bool hasBalance = address(this).balance > 0;
        upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
    }

    // external is a little cheaper than public because solidity knows that our contract can't call it
    // we are using ChainLink VRF
    // change requestRandomWinner to performUpkeep, since when time is up we wann request the random number
    function performUpkeep(bytes calldata /* performData */ ) override external {
        // dont care about "perform Data thast why (bool upkeepNeeded, )"
        (bool upkeepNeeded, ) = checkUpkeep(""); // passing blank call data
        if(!upkeepNeeded) {
            revert Raffle__UpkeepNotNeeded(address(this).balance, s_players.length, uint256(s_raffleState));
        }

        s_raffleState = RaffleState.CALCULATING; // so nobody can enter lottery if we requesting random number/winner
        // Request the random number
        // Once we get it, do something with it
        // Chainlink VRF is a 2 transaction process (which is good so people cant brute force simulate call?)
        // this function request the random number, next func will actually receive it
        // request Random words below returns a request ID
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLane, // gasLane... sets a ceilling for how much gas we willing to spend to get random #
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit, // upper gas limit on receiving function (fulfillRandomWOrds) we make it so we can change the value in constructor cuz we might wanna change it depending how we code the func
            NUM_WORDS // how many random numbers we wanna get
        );
        emit RequestedRaffleWinner(requestId);
    }

    // even tho it says Random word its a number
    // this function is overriding chainlinks, as it should chainlink expects it (so that we get the random number)
    // commenting out requestID tells our function hey I know u need the uint256 but we r not using the requestId
    function fulfillRandomWords(uint256 /*requestId*/, uint256[] memory randomWords) internal override {
        // let's say s_players size 10
        // randomNumber 202
        // 202 % 10? whats doesnt divide evenly into 202
        // % is the mod function
        // 20 * 10 = 200 so if u divide there remainder is 2, so 202 % 10 =2
        // we us the above to make sure we can pick a random player from player array even if random number is bigger than array size
        // we only getting one random word
        uint256 indexOfWinner = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[indexOfWinner];
        s_recentWinner = recentWinner;
        s_raffleState = RaffleState.OPEN; // re open raffle after winner is picked
        s_players = new address payable[](0); // new players array of size 0, reset after winner is picked
        s_lastTimeStamp = block.timestamp;
        // now let's send the money
        (bool success, ) = recentWinner.call{value: address(this).balance}("");
        // could do require(success) but we are gonna be more gas efficient
        if(!success){
            revert Raffle__TransferFailed();
        }
        emit WinnerPicked(recentWinner);
    }


    /* View / Pure Functions */
    function getEntranceFee() public view returns(uint256) {
        return i_entranceFee;
    }

    function getPlayer(uint256 index) public view returns(address) {
        return s_players[index];
    }

    function getRecentWinner() public view returns(address) {
        return s_recentWinner;
    }

    function getRaffleState() public view returns (RaffleState) {
        return s_raffleState;
    }

    // pure because its a constant and is not in storage (could use view but pure is better?)
    function getNumWords() public pure returns (uint256) {
        return NUM_WORDS;
    }

    function getNumberOfPlayers() public view returns (uint256) {
        return s_players.length;
    }

    function getLastTimeStamp() public view returns (uint256) {
        return s_lastTimeStamp;
    }

    function getRequestConfirmations() public pure returns (uint256) {
        return REQUEST_CONFIRMATIONS;
    }

    function getInterval() public view returns(uint256) {
        return i_interval;
    }
}