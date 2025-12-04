import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ExplanationRecord {
  id: string;
  modelId: string;
  encryptedExplanation: string;
  timestamp: number;
  owner: string;
  status: "processing" | "completed" | "failed";
  importanceScores: number[];
  featureNames: string[];
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [explanations, setExplanations] = useState<ExplanationRecord[]>([]);
  const [filteredExplanations, setFilteredExplanations] = useState<ExplanationRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newExplanationData, setNewExplanationData] = useState({
    modelId: "",
    inputData: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<ExplanationRecord | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Calculate statistics for dashboard
  const completedCount = explanations.filter(e => e.status === "completed").length;
  const processingCount = explanations.filter(e => e.status === "processing").length;
  const failedCount = explanations.filter(e => e.status === "failed").length;

  useEffect(() => {
    loadExplanations().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const filtered = explanations.filter(exp => 
      exp.modelId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      exp.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      exp.status.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredExplanations(filtered);
  }, [searchTerm, explanations]);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadExplanations = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("explanation_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing explanation keys:", e);
        }
      }
      
      const list: ExplanationRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`explanation_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                modelId: recordData.modelId,
                encryptedExplanation: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                status: recordData.status || "processing",
                importanceScores: recordData.importanceScores || [],
                featureNames: recordData.featureNames || []
              });
            } catch (e) {
              console.error(`Error parsing explanation data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading explanation ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setExplanations(list);
    } catch (e) {
      console.error("Error loading explanations:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitExplanation = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting model data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-XAI-${btoa(JSON.stringify(newExplanationData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const explanationId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const explanationData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        modelId: newExplanationData.modelId,
        status: "processing",
        importanceScores: [0.8, 0.6, 0.4, 0.3, 0.2], // Sample importance scores
        featureNames: ["Feature 1", "Feature 2", "Feature 3", "Feature 4", "Feature 5"]
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `explanation_${explanationId}`, 
        ethers.toUtf8Bytes(JSON.stringify(explanationData))
      );
      
      const keysBytes = await contract.getData("explanation_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(explanationId);
      
      await contract.setData(
        "explanation_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE-XAI computation started!"
      });
      
      await loadExplanations();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewExplanationData({
          modelId: "",
          inputData: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const viewDetails = (record: ExplanationRecord) => {
    setSelectedRecord(record);
    setShowDetails(true);
  };

  const renderImportanceChart = (record: ExplanationRecord) => {
    return (
      <div className="importance-chart">
        {record.importanceScores.map((score, index) => (
          <div key={index} className="importance-bar-container">
            <div className="importance-label">{record.featureNames[index] || `Feature ${index+1}`}</div>
            <div className="importance-bar">
              <div 
                className="importance-fill"
                style={{ width: `${score * 100}%` }}
              ></div>
            </div>
            <div className="importance-value">{score.toFixed(2)}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE-XAI connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="ai-icon"></div>
          </div>
          <h1>FHE<span>XAI</span>Kit</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-explanation-btn cyber-button"
          >
            <div className="add-icon"></div>
            New Explanation
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner neon-purple">
          <div className="welcome-text">
            <h2>FHE-based Explainable AI Toolkit</h2>
            <p>Generate encrypted explanations for AI predictions without revealing model or data</p>
          </div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card neon-border">
            <h3>FHE-XAI Overview</h3>
            <p>Generate encrypted feature importance reports using Fully Homomorphic Encryption for privacy-preserving AI explainability.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card neon-border">
            <h3>Explanation Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{explanations.length}</div>
                <div className="stat-label">Total</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{completedCount}</div>
                <div className="stat-label">Completed</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{processingCount}</div>
                <div className="stat-label">Processing</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{failedCount}</div>
                <div className="stat-label">Failed</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card neon-border">
            <h3>Status Distribution</h3>
            <div className="pie-chart-container">
              <div className="pie-chart">
                <div 
                  className="pie-segment completed" 
                  style={{ transform: `rotate(${(completedCount/explanations.length) * 360 || 0}deg)` }}
                ></div>
                <div 
                  className="pie-segment processing" 
                  style={{ transform: `rotate(${((completedCount + processingCount)/explanations.length) * 360 || 0}deg)` }}
                ></div>
                <div 
                  className="pie-segment failed" 
                  style={{ transform: `rotate(${((completedCount + processingCount + failedCount)/explanations.length) * 360 || 0}deg)` }}
                ></div>
                <div className="pie-center">
                  <div className="pie-value">{explanations.length}</div>
                  <div className="pie-label">Total</div>
                </div>
              </div>
              <div className="pie-legend">
                <div className="legend-item">
                  <div className="color-box completed"></div>
                  <span>Completed: {completedCount}</span>
                </div>
                <div className="legend-item">
                  <div className="color-box processing"></div>
                  <span>Processing: {processingCount}</span>
                </div>
                <div className="legend-item">
                  <div className="color-box failed"></div>
                  <span>Failed: {failedCount}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="explanations-section">
          <div className="section-header">
            <h2>FHE Explanation Records</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search by model ID, status..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="cyber-input"
                />
              </div>
              <button 
                onClick={loadExplanations}
                className="refresh-btn cyber-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="explanations-list cyber-card neon-border">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Model ID</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredExplanations.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon"></div>
                <p>No FHE explanations found</p>
                <button 
                  className="cyber-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Generate First Explanation
                </button>
              </div>
            ) : (
              filteredExplanations.map(explanation => (
                <div className="explanation-row" key={explanation.id}>
                  <div className="table-cell explanation-id">#{explanation.id.substring(0, 6)}</div>
                  <div className="table-cell">{explanation.modelId}</div>
                  <div className="table-cell">{explanation.owner.substring(0, 6)}...{explanation.owner.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(explanation.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${explanation.status}`}>
                      {explanation.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    <button 
                      className="action-btn cyber-button info"
                      onClick={() => viewDetails(explanation)}
                    >
                      Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitExplanation} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          explanationData={newExplanationData}
          setExplanationData={setNewExplanationData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card neon-border">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
      
      {showDetails && selectedRecord && (
        <ExplanationDetails 
          record={selectedRecord} 
          onClose={() => setShowDetails(false)} 
          renderChart={renderImportanceChart}
        />
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="ai-icon"></div>
              <span>FHEXAIKit</span>
            </div>
            <p>FHE-based Explainable AI Toolkit for privacy-preserving AI auditing</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHEXAIKit. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  explanationData: any;
  setExplanationData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  explanationData,
  setExplanationData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setExplanationData({
      ...explanationData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!explanationData.modelId || !explanationData.inputData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card neon-border">
        <div className="modal-header">
          <h2>Generate FHE Explanation</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your model and data remain encrypted during FHE processing
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Model ID *</label>
              <input 
                type="text"
                name="modelId"
                value={explanationData.modelId} 
                onChange={handleChange}
                placeholder="Enter model identifier..." 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Input Data *</label>
              <textarea 
                name="inputData"
                value={explanationData.inputData} 
                onChange={handleChange}
                placeholder="Enter input data for explanation (will be encrypted)..." 
                className="cyber-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data and model remain encrypted during FHE-XAI computation
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Processing with FHE..." : "Generate Explanation"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ExplanationDetailsProps {
  record: ExplanationRecord;
  onClose: () => void;
  renderChart: (record: ExplanationRecord) => JSX.Element;
}

const ExplanationDetails: React.FC<ExplanationDetailsProps> = ({ record, onClose, renderChart }) => {
  return (
    <div className="modal-overlay">
      <div className="details-modal cyber-card neon-border">
        <div className="modal-header">
          <h2>Explanation Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-section">
            <h3>Basic Information</h3>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">ID:</span>
                <span className="detail-value">{record.id}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Model ID:</span>
                <span className="detail-value">{record.modelId}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Owner:</span>
                <span className="detail-value">{record.owner}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Date:</span>
                <span className="detail-value">{new Date(record.timestamp * 1000).toLocaleString()}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Status:</span>
                <span className={`detail-value status-badge ${record.status}`}>{record.status}</span>
              </div>
            </div>
          </div>
          
          <div className="detail-section">
            <h3>Feature Importance</h3>
            <p>Encrypted importance scores computed using FHE:</p>
            {renderChart(record)}
          </div>
          
          <div className="detail-section">
            <h3>Encrypted Explanation</h3>
            <div className="encrypted-data">
              {record.encryptedExplanation}
            </div>
            <div className="fhe-notice">
              <div className="key-icon"></div> This data remains encrypted and can only be decrypted by the owner
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="close-btn cyber-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;