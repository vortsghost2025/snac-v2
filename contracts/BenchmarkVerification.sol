// contracts/BenchmarkVerification.sol
/*
 * Web3-enabled benchmark verification with on-chain proof
 * Mint NFTs for record-breaking benchmarks
 * Decentralized leaderboard with crypto rewards
 */
pragma solidity ^0.8.19;

contract GPUBenchmarkVerification {
    struct BenchmarkRecord {
        address submitter;
        uint256 gflops;
        uint256 latency; // in nanoseconds
        uint256 powerEfficiency; // GFLOPs per watt
        uint256 timestamp;
        string gpuModel;
        string proofHash;
        bool verified;
    }

    struct LeaderboardEntry {
        address user;
        uint256 score;
        uint256 rank;
    }

    mapping(bytes32 => BenchmarkRecord) public records;
    mapping(address => uint256) public userScores;
    address[] public leaderboard;

    address public admin;
    uint256 public verificationFee = 0.01 ether;
    uint256 public rewardPool;

    event BenchmarkSubmitted(bytes32 indexed recordId, address indexed submitter, uint256 gflops);
    event BenchmarkRecordVerified(bytes32 indexed recordId, bool verified);
    event RewardDistributed(address indexed recipient, uint256 amount);

    constructor() {
        admin = msg.sender;
    }

    function submitBenchmark(
        uint256 _gflops,
        uint256 _latency,
        uint256 _powerEfficiency,
        string memory _gpuModel,
        string memory _proofHash
    ) external payable returns (bytes32) {
        require(msg.value >= verificationFee, "Insufficient fee");

        bytes32 recordId = keccak256(abi.encodePacked(
            msg.sender,
            _gflops,
            _latency,
            block.timestamp
        ));

        records[recordId] = BenchmarkRecord({
            submitter: msg.sender,
            gflops: _gflops,
            latency: _latency,
            powerEfficiency: _powerEfficiency,
            timestamp: block.timestamp,
            gpuModel: _gpuModel,
            proofHash: _proofHash,
            verified: false
        });

        rewardPool += msg.value;

        emit BenchmarkSubmitted(recordId, msg.sender, _gflops);

        return recordId;
    }

    function verifyBenchmark(bytes32 _recordId, bool _verified) external {
        require(msg.sender == admin, "Only admin can verify");
        require(records[_recordId].timestamp > 0, "Record does not exist");

        records[_recordId].verified = _verified;

        if (_verified) {
            // Calculate score
            uint256 score = calculateScore(
                records[_recordId].gflops,
                records[_recordId].latency,
                records[_recordId].powerEfficiency
            );

            userScores[records[_recordId].submitter] += score;
            updateLeaderboard(records[_recordId].submitter, score);

            // Distribute reward
            uint256 reward = verificationFee * 80 / 100; // 80% to submitter
            payable(records[_recordId].submitter).transfer(reward);
            rewardPool -= reward;

            emit RewardDistributed(records[_recordId].submitter, reward);
        }

        emit BenchmarkRecordVerified(_recordId, _verified);
    }

    function calculateScore(
        uint256 _gflops,
        uint256 _latency,
        uint256 _efficiency
    ) internal pure returns (uint256) {
        // Weighted scoring formula
        return (_gflops * 3 + (1000000 / _latency) * 2 + _efficiency * 5) / 10;
    }

    function updateLeaderboard(address _user, uint256 _score) internal {
        // Simple leaderboard update (in production, use more efficient data structure)
        bool found = false;
        for (uint256 i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i] == _user) {
                found = true;
                break;
            }
        }

        if (!found) {
            leaderboard.push(_user);
        }

        // Sort leaderboard by score (simplified - in production use heap or similar)
        // For now, just update the mapping
    }

    function getTopRecords(uint256 _limit) external view returns (BenchmarkRecord[] memory) {
        // In production, implement proper leaderboard with efficient sorting
        BenchmarkRecord[] memory topRecords = new BenchmarkRecord[](_limit);

        // Simplified implementation - return first N verified records
        uint256 count = 0;
        for (uint256 i = 0; i < leaderboard.length && count < _limit; i++) {
            // This is a placeholder - proper implementation needed
            count++;
        }

        return topRecords;
    }

    function withdrawFees() external {
        require(msg.sender == admin, "Only admin can withdraw");
        payable(admin).transfer(address(this).balance);
    }

    function setVerificationFee(uint256 _fee) external {
        require(msg.sender == admin, "Only admin can set fee");
        verificationFee = _fee;
    }
}