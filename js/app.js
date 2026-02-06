/**
 * Fire Detection App - Main Application Controller
 */
class FireDetectionApp {
    constructor() {
        // Modules
        this.camera = new CameraManager();
        this.detector = new FireDetector();
        this.alerts = new AlertManager();
        
        // UI Elements
        this.statusCard = document.getElementById('statusCard');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.confidenceValue = document.getElementById('confidenceValue');
        this.confidenceFill = document.getElementById('confidenceFill');
        this.fireCount = document.getElementById('fireCount');
        this.smokeCount = document.getElementById('smokeCount');
        this.cameraContainer = document.getElementById('cameraContainer');
        this.detectionBadge = document.getElementById('detectionBadge');
        this.historyList = document.getElementById('historyList');
        
        // Buttons
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.silenceBtn = document.getElementById('silenceBtn');
        this.clearHistoryBtn = document.getElementById('clearHistoryBtn');
        this.settingsBtn = document.getElementById('settingsBtn');
        this.closeSettings = document.getElementById('closeSettings');
        
        // Settings
        this.sensitivitySlider = document.getElementById('sensitivitySlider');
        this.sensitivityValue = document.getElementById('sensitivityValue');
        this.cameraSelect = document.getElementById('cameraSelect');
        this.soundEnabled = document.getElementById('soundEnabled');
        this.flashEnabled = document.getElementById('flashEnabled');
        this.settingsModal = document.getElementById('settingsModal');
        
        // State
        this.isRunning = false;
        this.stats = { fire: 0, smoke: 0 };
        this.history = [];
        
        // Initialize
        this.init();
    }

    /**
     * Initialize the application
     */
    init() {
        this.bindEvents();
        this.setupDetector();
        this.checkCameraSupport();
        
        console.log('🔥 Fire Detection App initialized');
    }

    /**
     * Bind all event listeners
     */
    bindEvents() {
        // Control buttons
        this.startBtn.addEventListener('click', () => this.start());
        this.stopBtn.addEventListener('click', () => this.stop());
        this.silenceBtn.addEventListener('click', () => this.silence());
        this.clearHistoryBtn.addEventListener('click', () => this.clearHistory());
        
        // Settings
        this.settingsBtn.addEventListener('click', () => this.openSettings());
        this.closeSettings.addEventListener('click', () => this.closeSettingsModal());
        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) this.closeSettingsModal();
        });
        
        // Sensitivity slider
        this.sensitivitySlider.addEventListener('input', (e) => {
            const level = parseInt(e.target.value);
            this.detector.setSensitivity(level);
            this.updateSensitivityLabel(level);
        });
        
        // Camera select
        this.cameraSelect.addEventListener('change', () => {
            if (this.isRunning) {
                this.camera.switchCamera();
            }
        });
        
        // Sound/Flash toggles
        this.soundEnabled.addEventListener('change', (e) => {
            this.alerts.setSoundEnabled(e.target.checked);
        });
        
        this.flashEnabled.addEventListener('change', (e) => {
            this.alerts.setFlashEnabled(e.target.checked);
        });
        
        // Handle visibility change (pause when tab hidden)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isRunning) {
                console.log('Tab hidden - continuing detection');
            }
        });
    }

    /**
     * Setup detector callbacks
     */
    setupDetector() {
        // Confidence update callback - called every frame
        this.detector.onConfidenceUpdate = (result) => {
            this.updateConfidence(result);
        };
        
        // Detection callback
        this.detector.onDetection = (detection) => {
            this.handleDetection(detection);
        };
        
        // Auto-stop callback - when alarm auto-silences after 10 seconds
        this.alerts.onAutoStop = () => {
            this.cameraContainer.classList.remove('danger');
            this.detectionBadge.classList.remove('visible');
            if (this.isRunning) {
                this.updateStatus('safe', 'MONITORING');
            }
            console.log('Alarm auto-stopped - fire no longer detected');
        };
    }

    /**
     * Check if camera is supported
     */
    checkCameraSupport() {
        if (!CameraManager.isSupported()) {
            this.startBtn.disabled = true;
            this.startBtn.textContent = 'Camera Not Supported';
            console.error('Camera not supported on this device/browser');
        }
    }

    /**
     * Start detection
     */
    async start() {
        if (this.isRunning) return;
        
        this.startBtn.disabled = true;
        this.startBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                <path d="M21 12a9 9 0 11-6.219-8.56"></path>
            </svg>
            Starting...
        `;
        
        // Start camera
        const facingMode = this.cameraSelect.value;
        const cameraStarted = await this.camera.start(facingMode);
        
        if (!cameraStarted) {
            this.startBtn.disabled = false;
            this.startBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                Start Detection
            `;
            return;
        }
        
        // Start detection
        this.detector.start(this.camera);
        this.isRunning = true;
        
        // Update UI
        this.startBtn.disabled = true;
        this.startBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Running...
        `;
        this.stopBtn.disabled = false;
        
        this.updateStatus('safe', 'MONITORING');
        
        console.log('Detection started');
    }

    /**
     * Stop detection
     */
    stop() {
        if (!this.isRunning) return;
        
        this.detector.stop();
        this.camera.stop();
        this.alerts.reset();
        this.isRunning = false;
        
        // Update UI
        this.startBtn.disabled = false;
        this.startBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Start Detection
        `;
        this.stopBtn.disabled = true;
        this.silenceBtn.disabled = true;
        
        this.updateStatus('idle', 'IDLE');
        this.updateConfidenceUI(0);
        this.cameraContainer.classList.remove('danger');
        this.detectionBadge.classList.remove('visible');
        
        console.log('Detection stopped');
    }

    /**
     * Silence current alarm
     */
    silence() {
        this.alerts.silence();
        this.cameraContainer.classList.remove('danger');
        this.detectionBadge.classList.remove('visible');
        
        // Reset status after a moment
        setTimeout(() => {
            if (this.isRunning) {
                this.updateStatus('safe', 'MONITORING');
            }
        }, 1000);
    }

    /**
     * Handle detection event
     */
    handleDetection(detection) {
        console.log('Detection:', detection);
        
        // Update stats
        if (detection.type === 'fire') {
            this.stats.fire++;
            this.fireCount.textContent = this.stats.fire;
        } else {
            this.stats.smoke++;
            this.smokeCount.textContent = this.stats.smoke;
        }
        
        // Add to history
        this.addHistoryItem(detection);
        
        // Update UI for danger state
        this.updateStatus('danger', detection.type.toUpperCase() + ' DETECTED');
        this.cameraContainer.classList.add('danger');
        
        // Show detection badge
        const badge = this.detectionBadge;
        badge.querySelector('.badge-icon').textContent = detection.type === 'fire' ? '🔥' : '💨';
        badge.querySelector('.badge-text').textContent = detection.type.toUpperCase() + ' DETECTED';
        badge.classList.add('visible');
        
        // Trigger alert
        this.alerts.trigger(detection.type, detection.confidence);
        
        // Auto-hide badge after 5 seconds if silenced
        setTimeout(() => {
            if (this.alerts.isSilenced) {
                badge.classList.remove('visible');
                this.cameraContainer.classList.remove('danger');
            }
        }, 5000);
    }

    /**
     * Update confidence display
     */
    updateConfidence(result) {
        const maxConfidence = Math.max(result.fireConfidence, result.smokeConfidence);
        const percentage = Math.round(maxConfidence * 100);
        
        this.updateConfidenceUI(percentage);
        
        // Track fire detection status for auto-stop feature
        // Consider fire "detected" if confidence is above 30%
        const fireCurrentlyDetected = result.fireConfidence > 0.30 || result.smokeConfidence > 0.30;
        this.alerts.updateFireStatus(fireCurrentlyDetected);
        
        // Update status based on confidence
        if (!this.alerts.currentAlert) {
            if (percentage >= 50) {
                this.updateStatus('warning', 'ELEVATED');
            } else if (this.isRunning) {
                this.updateStatus('safe', 'MONITORING');
            }
        }
    }

    /**
     * Update confidence UI elements
     */
    updateConfidenceUI(percentage) {
        this.confidenceValue.textContent = percentage + '%';
        this.confidenceFill.style.width = percentage + '%';
        
        // Update color based on level
        this.confidenceFill.classList.remove('warning', 'danger');
        if (percentage >= 70) {
            this.confidenceFill.classList.add('danger');
        } else if (percentage >= 40) {
            this.confidenceFill.classList.add('warning');
        }
    }

    /**
     * Update status indicator
     */
    updateStatus(level, text) {
        this.statusIndicator.className = 'status-indicator ' + level;
        this.statusIndicator.querySelector('.indicator-text').textContent = text;
    }

    /**
     * Add item to history
     */
    addHistoryItem(detection) {
        const item = {
            type: detection.type,
            confidence: detection.confidence,
            timestamp: detection.timestamp
        };
        
        this.history.unshift(item);
        
        // Keep last 50 items
        if (this.history.length > 50) {
            this.history.pop();
        }
        
        this.renderHistory();
    }

    /**
     * Render history list
     */
    renderHistory() {
        if (this.history.length === 0) {
            this.historyList.innerHTML = `
                <div class="history-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
                    </svg>
                    <p>No alerts yet</p>
                    <span>Detection events will appear here</span>
                </div>
            `;
            return;
        }
        
        const html = this.history.map(item => {
            const time = new Date(item.timestamp).toLocaleTimeString();
            const icon = item.type === 'fire' ? '🔥' : '💨';
            const label = item.type === 'fire' ? 'Fire Detected' : 'Smoke Detected';
            
            return `
                <div class="history-item">
                    <span class="history-icon">${icon}</span>
                    <div class="history-content">
                        <span class="history-type ${item.type}">${label}</span>
                        <span class="history-time">${time}</span>
                    </div>
                    <span class="history-confidence">${item.confidence}%</span>
                </div>
            `;
        }).join('');
        
        this.historyList.innerHTML = html;
    }

    /**
     * Clear history
     */
    clearHistory() {
        this.history = [];
        this.stats = { fire: 0, smoke: 0 };
        this.fireCount.textContent = '0';
        this.smokeCount.textContent = '0';
        this.renderHistory();
    }

    /**
     * Update sensitivity label
     */
    updateSensitivityLabel(level) {
        const labels = { 1: 'Low', 2: 'Medium', 3: 'High' };
        this.sensitivityValue.textContent = labels[level];
    }

    /**
     * Open settings modal
     */
    openSettings() {
        this.settingsModal.classList.add('visible');
    }

    /**
     * Close settings modal
     */
    closeSettingsModal() {
        this.settingsModal.classList.remove('visible');
    }
}

// Add CSS for spinner
const style = document.createElement('style');
style.textContent = `
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
    .spin {
        animation: spin 1s linear infinite;
    }
`;
document.head.appendChild(style);

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new FireDetectionApp();
});
