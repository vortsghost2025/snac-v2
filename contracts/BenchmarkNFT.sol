// contracts/BenchmarkNFT.sol
/*
 * NFT contract for minting record-breaking benchmark achievements
 * Each NFT represents a verified benchmark record with metadata
 */
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract BenchmarkNFT is ERC721, Ownable {
    using Strings for uint256;

    struct NFTMetadata {
        uint256 gflops;
        uint256 latency; // in nanoseconds
        string gpuModel;
        uint256 timestamp;
        string proofUrl;
        uint256 rarity; // 1-5 scale based on performance percentile
    }

    mapping(uint256 => NFTMetadata) public nftMetadata;
    uint256 public nextTokenId;
    uint256 public mintingFee = 0.005 ether;

    address public benchmarkContract; // Address of the verification contract

    event NFTMinted(uint256 indexed tokenId, address indexed recipient, uint256 gflops);

    constructor(address _benchmarkContract) ERC721("GPUBenchmarkNFT", "GBNFT") {
        benchmarkContract = _benchmarkContract;
        nextTokenId = 1;
    }

    function mintRecordNFT(
        address _to,
        uint256 _gflops,
        uint256 _latency,
        string memory _gpuModel,
        string memory _proofUrl
    ) external payable returns (uint256) {
        require(msg.value >= mintingFee, "Insufficient minting fee");

        // Only the benchmark contract can mint NFTs (ensures verification)
        require(msg.sender == benchmarkContract || msg.sender == owner(), "Unauthorized minting");

        uint256 tokenId = nextTokenId++;

        _mint(_to, tokenId);

        // Calculate rarity based on performance
        uint256 rarity = calculateRarity(_gflops);

        nftMetadata[tokenId] = NFTMetadata({
            gflops: _gflops,
            latency: _latency,
            gpuModel: _gpuModel,
            timestamp: block.timestamp,
            proofUrl: _proofUrl,
            rarity: rarity
        });

        emit NFTMinted(tokenId, _to, _gflops);

        return tokenId;
    }

    function calculateRarity(uint256 _gflops) internal pure returns (uint256) {
        // Rarity tiers based on GFLOPS performance
        if (_gflops >= 20000) return 5; // Legendary
        if (_gflops >= 15000) return 4; // Epic
        if (_gflops >= 10000) return 3; // Rare
        if (_gflops >= 5000) return 2;  // Uncommon
        return 1; // Common
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "Token does not exist");

        NFTMetadata memory metadata = nftMetadata[tokenId];

        string memory json = string(abi.encodePacked(
            '{"name": "GPU Benchmark Record #',
            tokenId.toString(),
            '", "description": "A verified GPU benchmark record on ',
            metadata.gpuModel,
            '", "attributes": [',
            '{"trait_type": "GFLOPS", "value": "',
            metadata.gflops.toString(),
            '"}, {"trait_type": "Latency", "value": "',
            metadata.latency.toString(),
            ' ns"}, {"trait_type": "GPU Model", "value": "',
            metadata.gpuModel,
            '"}, {"trait_type": "Rarity", "value": "',
            getRarityName(metadata.rarity),
            '"}, {"trait_type": "Timestamp", "value": "',
            metadata.timestamp.toString(),
            '"}], "image": "',
            metadata.proofUrl,
            '"}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            base64Encode(bytes(json))
        ));
    }

    function getRarityName(uint256 rarity) internal pure returns (string memory) {
        if (rarity == 5) return "Legendary";
        if (rarity == 4) return "Epic";
        if (rarity == 3) return "Rare";
        if (rarity == 2) return "Uncommon";
        return "Common";
    }

    function base64Encode(bytes memory data) internal pure returns (string memory) {
        // Simplified base64 encoding for demo
        // In production, use proper base64 library
        return "BASE64_ENCODED_DATA";
    }

    function withdrawFees() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function setMintingFee(uint256 _fee) external onlyOwner {
        mintingFee = _fee;
    }

    function setBenchmarkContract(address _contract) external onlyOwner {
        benchmarkContract = _contract;
    }

    // Batch minting for multiple records
    function batchMint(
        address[] memory _recipients,
        uint256[] memory _gflops,
        uint256[] memory _latencies,
        string[] memory _gpuModels,
        string[] memory _proofUrls
    ) external onlyOwner {
        require(_recipients.length == _gflops.length &&
                _gflops.length == _latencies.length &&
                _latencies.length == _gpuModels.length &&
                _gpuModels.length == _proofUrls.length,
                "Array length mismatch");

        for (uint256 i = 0; i < _recipients.length; i++) {
            mintRecordNFT(_recipients[i], _gflops[i], _latencies[i], _gpuModels[i], _proofUrls[i]);
        }
    }
}