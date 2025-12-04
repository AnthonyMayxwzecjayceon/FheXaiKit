// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ExplainableAIFHE is SepoliaConfig {
    struct EncryptedPrediction {
        uint256 predictionId;
        euint32 encryptedInputs;      // Encrypted model inputs
        euint32 encryptedOutput;      // Encrypted model prediction
        euint32 encryptedModelHash;   // Encrypted model identifier
        uint256 timestamp;
    }

    struct EncryptedExplanation {
        uint256 explanationId;
        euint32 encryptedShapValues;  // Encrypted SHAP values
        euint32 encryptedLimeWeights;  // Encrypted LIME weights
        euint32 encryptedImportance;   // Encrypted feature importance
        uint256 predictionId;
        uint256 generatedAt;
    }

    struct DecryptedExplanation {
        uint32[] shapValues;
        uint32[] limeWeights;
        uint32[] importance;
        bool isRevealed;
    }

    uint256 public predictionCount;
    uint256 public explanationCount;
    mapping(uint256 => EncryptedPrediction) public encryptedPredictions;
    mapping(uint256 => EncryptedExplanation) public encryptedExplanations;
    mapping(uint256 => DecryptedExplanation) public decryptedExplanations;
    
    mapping(uint256 => uint256) private requestToPredictionId;
    mapping(uint256 => uint256) private explanationRequestToId;
    
    event PredictionSubmitted(uint256 indexed predictionId, uint256 timestamp);
    event ExplanationRequested(uint256 indexed requestId, uint256 predictionId);
    event ExplanationGenerated(uint256 indexed explanationId);
    event ExplanationDecrypted(uint256 indexed explanationId);

    modifier onlyOwner(uint256 predictionId) {
        // Add proper ownership verification in production
        _;
    }

    function submitEncryptedPrediction(
        euint32 encryptedInputs,
        euint32 encryptedOutput,
        euint32 encryptedModelHash
    ) public {
        predictionCount += 1;
        uint256 newPredictionId = predictionCount;
        
        encryptedPredictions[newPredictionId] = EncryptedPrediction({
            predictionId: newPredictionId,
            encryptedInputs: encryptedInputs,
            encryptedOutput: encryptedOutput,
            encryptedModelHash: encryptedModelHash,
            timestamp: block.timestamp
        });
        
        emit PredictionSubmitted(newPredictionId, block.timestamp);
    }

    function requestExplanation(uint256 predictionId) public onlyOwner(predictionId) {
        EncryptedPrediction storage prediction = encryptedPredictions[predictionId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(prediction.encryptedInputs);
        ciphertexts[1] = FHE.toBytes32(prediction.encryptedOutput);
        ciphertexts[2] = FHE.toBytes32(prediction.encryptedModelHash);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.generateExplanation.selector);
        requestToPredictionId[reqId] = predictionId;
        
        emit ExplanationRequested(reqId, predictionId);
    }

    function generateExplanation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 predictionId = requestToPredictionId[requestId];
        require(predictionId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32[] memory inputs, uint32 output, uint32 modelHash) = 
            abi.decode(cleartexts, (uint32[], uint32, uint32));
        
        // Simulate FHE-XAI computation (in production this would be done off-chain)
        explanationCount += 1;
        uint256 newExplanationId = explanationCount;
        
        // Simplified XAI results
        uint32[] memory shapValues = new uint32[](inputs.length);
        uint32[] memory limeWeights = new uint32[](inputs.length);
        uint32[] memory importance = new uint32[](inputs.length);
        
        for (uint i = 0; i < inputs.length; i++) {
            shapValues[i] = inputs[i] * 10;
            limeWeights[i] = inputs[i] * 5;
            importance[i] = inputs[i] * 15;
        }
        
        encryptedExplanations[newExplanationId] = EncryptedExplanation({
            explanationId: newExplanationId,
            encryptedShapValues: FHE.asEuint32(0), // Placeholder for encrypted SHAP
            encryptedLimeWeights: FHE.asEuint32(0), // Placeholder for encrypted LIME
            encryptedImportance: FHE.asEuint32(0), // Placeholder for encrypted importance
            predictionId: predictionId,
            generatedAt: block.timestamp
        });
        
        decryptedExplanations[newExplanationId] = DecryptedExplanation({
            shapValues: shapValues,
            limeWeights: limeWeights,
            importance: importance,
            isRevealed: false
        });
        
        emit ExplanationGenerated(newExplanationId);
    }

    function requestExplanationDecryption(uint256 explanationId) public onlyOwner(explanationId) {
        EncryptedExplanation storage explanation = encryptedExplanations[explanationId];
        require(!decryptedExplanations[explanationId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(explanation.encryptedShapValues);
        ciphertexts[1] = FHE.toBytes32(explanation.encryptedLimeWeights);
        ciphertexts[2] = FHE.toBytes32(explanation.encryptedImportance);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptExplanation.selector);
        explanationRequestToId[reqId] = explanationId;
    }

    function decryptExplanation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 explanationId = explanationRequestToId[requestId];
        require(explanationId != 0, "Invalid request");
        
        DecryptedExplanation storage dExplanation = decryptedExplanations[explanationId];
        require(!dExplanation.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32[] memory shapValues, uint32[] memory limeWeights, uint32[] memory importance) = 
            abi.decode(cleartexts, (uint32[], uint32[], uint32[]));
        
        dExplanation.shapValues = shapValues;
        dExplanation.limeWeights = limeWeights;
        dExplanation.importance = importance;
        dExplanation.isRevealed = true;
        
        emit ExplanationDecrypted(explanationId);
    }

    function getDecryptedExplanation(uint256 explanationId) public view returns (
        uint32[] memory shapValues,
        uint32[] memory limeWeights,
        uint32[] memory importance,
        bool isRevealed
    ) {
        DecryptedExplanation storage e = decryptedExplanations[explanationId];
        return (e.shapValues, e.limeWeights, e.importance, e.isRevealed);
    }

    function getEncryptedPrediction(uint256 predictionId) public view returns (
        euint32 inputs,
        euint32 output,
        euint32 modelHash,
        uint256 timestamp
    ) {
        EncryptedPrediction storage p = encryptedPredictions[predictionId];
        return (p.encryptedInputs, p.encryptedOutput, p.encryptedModelHash, p.timestamp);
    }

    function getEncryptedExplanation(uint256 explanationId) public view returns (
        euint32 shapValues,
        euint32 limeWeights,
        euint32 importance,
        uint256 predictionId,
        uint256 generatedAt
    ) {
        EncryptedExplanation storage e = encryptedExplanations[explanationId];
        return (e.encryptedShapValues, e.encryptedLimeWeights, e.encryptedImportance, e.predictionId, e.generatedAt);
    }

    // Helper functions for demo purposes
    function computeShapValues(uint32[] memory inputs, uint32 output) private pure returns (uint32[] memory) {
        uint32[] memory values = new uint32[](inputs.length);
        for (uint i = 0; i < inputs.length; i++) {
            values[i] = inputs[i] * output / 100;
        }
        return values;
    }

    function computeLimeWeights(uint32[] memory inputs) private pure returns (uint32[] memory) {
        uint32[] memory weights = new uint32[](inputs.length);
        for (uint i = 0; i < inputs.length; i++) {
            weights[i] = inputs[i] * 2;
        }
        return weights;
    }
}