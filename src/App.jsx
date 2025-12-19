import React, { useState, useEffect, useMemo } from 'react';
import { 
  ClipboardList, Trophy, Save, Calendar, Clock, 
  ChevronLeft, ChevronRight, Trash2, BarChart3, 
  School, CheckCircle2, AlertTriangle, Lock, Settings,
  MessageSquare // 新增圖標
} from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, doc, onSnapshot, 
  serverTimestamp, writeBatch, getDocs, query, orderBy, setDoc
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';

// --- Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyDwdwx7-hcD9OFo_vfRVoI7ZZwyy-QHrvI",
  authDomain: "school-orderliness.firebaseapp.com",
  projectId: "school-orderliness",
  storageBucket: "school-orderliness.firebasestorage.app",
  messagingSenderId: "479350417864",
  appId: "1:479350417864:web:d44c8030b4900b195378fd"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const APP_ID_PATH = 'school-system-v1'; 
const COLLECTION_NAME = "school_orderliness_scores_v2";

const SETTINGS_COLLECTION = "system_settings"; 
const SETTINGS_DOC_ID = "config"; 

// --- Constants & Data ---
const GRADES = [1, 2, 3];
const PERIODS = ["早自修", "升旗/集會", "上課秩序", "午休", "打掃時間", "放學"];

// Default counts if no settings found
const DEFAULT_CLASS_COUNTS = {
  1: 4, 
  2: 5, 
  3: 5  
};

// Helper: Generate Classes Array based on counts
const generateClasses = (grade, counts) => 
  Array.from({ length: counts[grade] || 0 }, (_, i) => `${grade}${String(i + 1).padStart(2, '0')}`);

// Helper: Get Week Number
const getWeekNumber = (d) => {
  if (!d || isNaN(d.getTime())) return "Invalid-Date";
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

const App = () => {
  // --- State ---
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState('score');
  const [scoresData, setScoresData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Settings State
  const [classCounts, setClassCounts] = useState(DEFAULT_CLASS_COUNTS);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [tempCounts, setTempCounts] = useState(DEFAULT_CLASS_COUNTS); // For editing in modal

  // UI Components State
  const [modalConfig, setModalConfig] = useState({ isOpen: false, type: '', title: '', message: '', onConfirm: null });
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminAction, setAdminAction] = useState(null); // 'CLEAR_HISTORY' | 'OPEN_SETTINGS'

  // Scoring Form State
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedPeriod, setSelectedPeriod] = useState("早自修");
  const [selectedGrade, setSelectedGrade] = useState(1);
  const [currentScores, setCurrentScores] = useState({}); 
  const [feedback, setFeedback] = useState(""); // 新增：反映事項

  // Ranking View State
  const [viewWeek, setViewWeek] = useState(getWeekNumber(new Date()));

  // --- Auth & Sync ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (e) {
        console.error("Firebase Auth Error:", e);
        showToast(`登入失敗: ${e.message}`, 'error');
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Sync Scores Data
  useEffect(() => {
    if (!authReady || !user) return;
    
    const q = query(
      collection(db, 'artifacts', APP_ID_PATH, 'public', 'data', COLLECTION_NAME),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setScoresData(data);
      setLoading(false);
    }, (error) => {
      console.error("Snapshot Error:", error);
      if (error.code !== 'permission-denied') {
        showToast("無法讀取資料，請檢查網路", 'error');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [authReady, user]);

  // Sync Settings Data
  useEffect(() => {
    if (!authReady || !user) return;

    try {
      const docRef = doc(db, 'artifacts', APP_ID_PATH, 'public', 'data', SETTINGS_COLLECTION, SETTINGS_DOC_ID);
      const unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.classCounts) {
            setClassCounts(data.classCounts);
          }
        }
      }, (error) => {
        console.error("Settings Sync Error:", error);
      });
      return () => unsubscribe();
    } catch (e) {
      console.error("Invalid Path Error:", e);
    }
  }, [authReady, user]);

  // --- Helper UI Functions ---
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
  };

  const closeModal = () => {
    setModalConfig({ isOpen: false, type: '', title: '', message: '', onConfirm: null });
    setAdminPassword('');
  };

  // --- Calculations ---
  const currentWeekTotals = useMemo(() => {
    const todayWeek = getWeekNumber(new Date(selectedDate)); 
    const filtered = scoresData.filter(d => d.week === todayWeek);
    const totals = {}; 
    // Init with current class config
    GRADES.forEach(g => generateClasses(g, classCounts).forEach(c => totals[c] = 0));
    
    filtered.forEach(record => {
      if (totals[record.classId] === undefined) totals[record.classId] = 0;
      totals[record.classId] += record.score;
    });
    return totals; 
  }, [scoresData, selectedDate, classCounts]);

  const weeklyRankings = useMemo(() => {
    const filtered = scoresData.filter(d => d.week === viewWeek);
    const totals = {}; 
    GRADES.forEach(g => generateClasses(g, classCounts).forEach(c => totals[c] = 0));
    
    filtered.forEach(record => {
      if (totals[record.classId] === undefined) totals[record.classId] = 0;
      totals[record.classId] += record.score;
    });
    const result = {};
    GRADES.forEach(g => {
      const gradeClasses = Object.keys(totals).filter(c => c.startsWith(String(g)));
      const sorted = gradeClasses.map(c => ({ classId: c, total: totals[c] }))
                                 .sort((a, b) => b.total - a.total);
      result[g] = sorted;
    });
    return result;
  }, [scoresData, viewWeek, classCounts]);

  const currentWeekLabel = useMemo(() => {
     const parts = viewWeek.split('-W');
     if (parts.length !== 2) return viewWeek;
     return `${parts[0]}年 第 ${parts[1]} 週`;
  }, [viewWeek]);

  // --- Handlers ---
  const handleScoreChange = (classId, val) => {
    setCurrentScores(prev => ({ ...prev, [classId]: val }));
  };

  const handleConfirmSubmit = () => {
    if (!user) return showToast("系統尚未連線", 'error');
    if (Object.keys(currentScores).length === 0) return showToast("請至少評分一個班級", 'error');
    if (!selectedDate) return showToast("請選擇日期", 'error');

    setModalConfig({
      isOpen: true,
      type: 'confirm',
      title: '確認儲存',
      message: `確定要儲存 ${selectedDate} [${selectedPeriod}] 的評分嗎？`,
      onConfirm: executeSubmit
    });
  };

  const executeSubmit = async () => {
    closeModal();
    setSubmitting(true);

    try {
      const batch = writeBatch(db);
      const weekNum = getWeekNumber(new Date(selectedDate));
      const timestamp = serverTimestamp();
      const raterUid = user.uid; 
      
      let opCount = 0;
      Object.entries(currentScores).forEach(([classId, score]) => {
        const docRef = doc(collection(db, 'artifacts', APP_ID_PATH, 'public', 'data', COLLECTION_NAME));
        const gradeNum = parseInt(classId.substring(0, 1), 10);
        const scoreNum = Number(score);
        
        if (!isNaN(gradeNum) && !isNaN(scoreNum)) {
          batch.set(docRef, {
            date: selectedDate,
            week: weekNum,
            period: selectedPeriod,
            grade: gradeNum,
            classId: String(classId),
            score: scoreNum,
            note: feedback.trim(), // 新增：儲存備註
            createdAt: timestamp,
            raterUid: raterUid
          });
          opCount++;
        }
      });

      if (opCount > 0) {
        await batch.commit();
        showToast(`成功儲存 ${opCount} 筆評分！`, 'success');
        setCurrentScores({});
        setFeedback(""); // 清空備註
      } else {
        showToast("沒有有效的評分數據", 'error');
      }
    } catch (e) {
      console.error("Submit Error:", e);
      showToast(`儲存失敗: ${e.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = (recordId) => {
    setModalConfig({
      isOpen: true,
      type: 'delete',
      title: '刪除紀錄',
      message: '確定要刪除這筆評分紀錄嗎？此動作無法復原。',
      onConfirm: () => executeDelete(recordId)
    });
  };

  const executeDelete = async (recordId) => {
    closeModal();
    try {
      const batch = writeBatch(db);
      const docRef = doc(db, 'artifacts', APP_ID_PATH, 'public', 'data', COLLECTION_NAME, recordId);
      batch.delete(docRef);
      await batch.commit();
      showToast("紀錄已刪除", 'success');
    } catch (e) {
      showToast(`刪除失敗: ${e.message}`, 'error');
    }
  };

  // --- Admin Logic ---
  const requestAdminAction = (action) => {
    setAdminAction(action);
    setShowAdminModal(true);
  };

  const verifyAdminPassword = () => {
    if (adminPassword !== "admin888") {
      showToast("密碼錯誤", 'error');
      return;
    }
    setShowAdminModal(false);
    setAdminPassword('');
    
    // Dispatch Action
    if (adminAction === 'CLEAR_HISTORY') {
      confirmClearHistory();
    } else if (adminAction === 'OPEN_SETTINGS') {
      setTempCounts({...classCounts}); // Init temp state with current values
      setShowSettingsModal(true);
    }
  };

  const confirmClearHistory = () => {
    setModalConfig({
      isOpen: true,
      type: 'delete',
      title: '清空所有資料',
      message: '警告：這將刪除資料庫中「所有」的歷史評分資料，確定要執行嗎？',
      onConfirm: async () => {
        closeModal();
        setSubmitting(true);
        try {
          const q = collection(db, 'artifacts', APP_ID_PATH, 'public', 'data', COLLECTION_NAME);
          const snapshot = await getDocs(q);
          const batch = writeBatch(db);
          snapshot.docs.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
          showToast("所有資料已清空", 'success');
        } catch (e) {
          showToast(`清空失敗: ${e.message}`, 'error');
        } finally {
          setSubmitting(false);
        }
      }
    });
  };

  const saveSettings = async () => {
    setShowSettingsModal(false);
    setSubmitting(true);
    try {
        // FIX: Use 6-segment path
        const docRef = doc(db, 'artifacts', APP_ID_PATH, 'public', 'data', SETTINGS_COLLECTION, SETTINGS_DOC_ID);
        await setDoc(docRef, { classCounts: tempCounts }, { merge: true });
        showToast("系統設定已更新", 'success');
    } catch(e) {
        showToast(`設定儲存失敗: ${e.message}`, 'error');
    } finally {
        setSubmitting(false);
    }
  };

  const changeWeek = (delta) => {
    const [year, week] = viewWeek.split('-W').map(Number);
    if (!year || !week) return;
    let newYear = year;
    let newWeek = week + delta;
    if (newWeek > 52) { newWeek = 1; newYear++; }
    if (newWeek < 1) { newWeek = 52; newYear--; }
    setViewWeek(`${newYear}-W${String(newWeek).padStart(2, '0')}`);
  };

  // --- Sub-Components ---
  const ClassScoreRow = ({ classId, currentWeekTotal }) => {
    const score = currentScores.hasOwnProperty(classId) ? currentScores[classId] : 0;
    const scoreText = `${currentWeekTotal > 0 ? '+' : ''}${currentWeekTotal}`;
    const scoreColorClass = currentWeekTotal > 0 ? 'text-emerald-600' : (currentWeekTotal < 0 ? 'text-red-500' : 'text-slate-500');

    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white p-3 rounded-lg shadow-sm border border-slate-200 gap-3">
        <div className="flex flex-col w-24 items-center justify-center sm:justify-start bg-slate-50 sm:bg-transparent rounded py-1 sm:py-0">
          <div className="font-black text-lg text-slate-800">{classId}</div>
          <div className={`text-xs font-medium ${scoreColorClass}`}>
            本週累積: <span className="font-bold">{scoreText}</span>
          </div>
        </div>
        <div className="flex items-center justify-center gap-1 flex-1 overflow-x-auto">
           <div className="flex items-center bg-slate-50 rounded-lg p-1 gap-1">
             {[-3, -2, -1].map(v => (
               <button
                 key={v}
                 onClick={() => handleScoreChange(classId, v)}
                 className={`w-9 h-9 sm:w-10 sm:h-10 rounded font-bold text-sm transition-all flex items-center justify-center
                   ${score === v ? 'bg-red-500 text-white shadow-md scale-110 z-10' : 'text-red-400 hover:bg-red-100 bg-white border border-slate-100'}`}
               >
                 {v}
               </button>
             ))}
             <button
               onClick={() => handleScoreChange(classId, 0)}
               className={`w-9 h-9 sm:w-10 sm:h-10 rounded font-bold text-sm transition-all flex items-center justify-center mx-1
                 ${score === 0 ? 'bg-slate-500 text-white shadow-md scale-110 z-10' : 'text-slate-400 hover:bg-slate-200 bg-white border border-slate-100'}`}
             >
               0
             </button>
             {[1, 2, 3].map(v => (
               <button
                 key={v}
                 onClick={() => handleScoreChange(classId, v)}
                 className={`w-9 h-9 sm:w-10 sm:h-10 rounded font-bold text-sm transition-all flex items-center justify-center
                   ${score === v ? 'bg-emerald-500 text-white shadow-md scale-110 z-10' : 'text-emerald-400 hover:bg-emerald-100 bg-white border border-slate-100'}`}
               >
                 +{v}
               </button>
             ))}
           </div>
        </div>
      </div>
    );
  };

  // --- Render ---
  if (!authReady || loading) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-100">
          <div className="flex flex-col items-center p-8 bg-white rounded-xl shadow-lg">
            <svg className="animate-spin h-8 w-8 text-indigo-500 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-slate-600 font-medium">系統初始化中...</p>
          </div>
        </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-800 pb-20 relative">
      
      {/* Custom Modal Overlay */}
      {modalConfig.isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden transform transition-all scale-100">
            <div className={`p-4 ${modalConfig.type === 'delete' ? 'bg-red-50' : 'bg-indigo-50'} border-b border-slate-100 flex items-center gap-3`}>
              {modalConfig.type === 'delete' ? <AlertTriangle className="text-red-500"/> : <CheckCircle2 className="text-indigo-500"/>}
              <h3 className="font-bold text-lg text-slate-800">{modalConfig.title}</h3>
            </div>
            <div className="p-6">
              <p className="text-slate-600 font-medium">{modalConfig.message}</p>
            </div>
            <div className="p-4 bg-slate-50 flex gap-3">
              <button onClick={closeModal} className="flex-1 py-2.5 text-slate-500 font-bold hover:bg-slate-200 rounded-lg transition-colors">取消</button>
              <button 
                onClick={modalConfig.onConfirm} 
                className={`flex-1 py-2.5 text-white font-bold rounded-lg shadow-lg transition-transform active:scale-95 ${modalConfig.type === 'delete' ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Password Modal */}
      {showAdminModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden">
            <div className="p-4 bg-slate-900 text-white flex items-center gap-2">
              <Lock size={20}/>
              <h3 className="font-bold">管理員權限</h3>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-500 mb-2">請輸入管理密碼以繼續：</p>
              <input 
                type="password" 
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-bold tracking-widest"
                placeholder="Password"
              />
            </div>
            <div className="p-4 bg-slate-50 flex gap-3">
              <button onClick={() => setShowAdminModal(false)} className="flex-1 py-2 text-slate-500 font-bold hover:bg-slate-200 rounded-lg">取消</button>
              <button onClick={verifyAdminPassword} className="flex-1 py-2 bg-slate-900 text-white font-bold rounded-lg hover:bg-black">驗證</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal (New) */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden">
             <div className="p-4 bg-slate-800 text-white flex items-center gap-2">
              <Settings size={20}/>
              <h3 className="font-bold">系統參數設定</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-500 border-b border-slate-100 pb-2">請設定各年級的班級總數：</p>
              {GRADES.map(grade => (
                <div key={grade} className="flex items-center justify-between">
                  <label className="font-bold text-slate-700">{grade} 年級</label>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setTempCounts(prev => ({...prev, [grade]: Math.max(1, (prev[grade] || 0) - 1)}))}
                      className="w-8 h-8 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"
                    >-</button>
                    <span className="w-12 text-center font-bold text-xl">{tempCounts[grade]} 班</span>
                    <button 
                      onClick={() => setTempCounts(prev => ({...prev, [grade]: Math.min(20, (prev[grade] || 0) + 1)}))}
                      className="w-8 h-8 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"
                    >+</button>
                  </div>
                </div>
              ))}
              <div className="text-xs text-slate-400 bg-slate-50 p-2 rounded mt-2">
                注意：減少班級數將導致該班級從評分表中隱藏，但歷史數據仍會保留。
              </div>
            </div>
            <div className="p-4 bg-slate-50 flex gap-3">
              <button onClick={() => setShowSettingsModal(false)} className="flex-1 py-2 text-slate-500 font-bold hover:bg-slate-200 rounded-lg">取消</button>
              <button onClick={saveSettings} className="flex-1 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 shadow">儲存設定</button>
            </div>
          </div>
        </div>
      )}


      {/* Toast Notification */}
      <div className={`fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-300 ${toast.show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
        <div className={`flex items-center gap-3 px-6 py-3 rounded-full shadow-2xl border ${toast.type === 'error' ? 'bg-red-600 text-white border-red-700' : 'bg-emerald-600 text-white border-emerald-700'}`}>
          {toast.type === 'error' ? <AlertTriangle size={20} className="animate-pulse"/> : <CheckCircle2 size={20}/>}
          <span className="font-bold tracking-wide">{toast.message}</span>
        </div>
      </div>

      {/* Header */}
      <header className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-20">
        <div className="max-w-3xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500 rounded-lg">
              <School size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-wide">校園秩序評分系統</h1>
              <p className="text-xs text-slate-400 flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${user ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
                {user ? `已連線` : '連線中...'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {activeTab === 'history' && (
               <button onClick={() => requestAdminAction('CLEAR_HISTORY')} className="text-xs bg-red-900/50 text-red-200 px-3 py-1.5 rounded border border-red-800 hover:bg-red-900 flex items-center gap-1">
                 <Trash2 size={12}/> 清除資料
               </button>
            )}
            <button onClick={() => requestAdminAction('OPEN_SETTINGS')} className="p-2 bg-slate-800 rounded hover:bg-slate-700 text-slate-300 hover:text-white transition-colors">
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4">
        
        {/* Tabs */}
        <div className="flex bg-white p-1 rounded-xl shadow-sm mb-6 border border-slate-200">
          <button 
            onClick={() => setActiveTab('score')}
            className={`flex-1 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'score' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <ClipboardList size={18} /> 評分輸入
          </button>
          <button 
            onClick={() => setActiveTab('ranking')}
            className={`flex-1 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'ranking' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <Trophy size={18} /> 本週榮譽榜
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'history' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <BarChart3 size={18} /> 歷史紀錄
          </button>
        </div>

        {/* SCORING TAB */}
        {activeTab === 'score' && (
          <div className="animate-fade-in">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">日期</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                    <input 
                      type="date" 
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="w-full pl-10 pr-3 py-2 border border-slate-200 rounded-lg bg-slate-50 focus:border-indigo-500 outline-none text-sm font-bold"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">時段</label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                    <select 
                      value={selectedPeriod} 
                      onChange={(e) => setSelectedPeriod(e.target.value)}
                      className="w-full pl-10 pr-3 py-2 border border-slate-200 rounded-lg bg-slate-50 focus:border-indigo-500 outline-none text-sm font-bold appearance-none"
                    >
                      {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2 uppercase">選擇年級</label>
                <div className="flex gap-2">
                  {GRADES.map(g => (
                    <button
                      key={g}
                      onClick={() => setSelectedGrade(g)}
                      className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${selectedGrade === g ? 'bg-slate-800 text-white shadow-md ring-2 ring-offset-2 ring-slate-800' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >
                      {g} 年級
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              {generateClasses(selectedGrade, classCounts).map(classId => (
                <ClassScoreRow 
                  key={classId} 
                  classId={classId} 
                  currentWeekTotal={currentWeekTotals[classId] || 0} 
                />
              ))}
            </div>

            {/* 新增：反映事項 (Feedback Input) */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-20">
              <label className="block text-xs font-bold text-slate-400 mb-2 uppercase flex items-center gap-2">
                <MessageSquare size={14}/> 
                反映事項 (選填)
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                className="w-full p-3 border border-slate-200 rounded-lg bg-slate-50 focus:border-indigo-500 outline-none text-sm min-h-[80px]"
                placeholder="請輸入評分時的特殊狀況或是備註..."
              />
            </div>

            <div className="fixed bottom-6 left-0 right-0 px-4 z-30 max-w-3xl mx-auto">
              <button 
                onClick={handleConfirmSubmit}
                disabled={submitting}
                className="w-full bg-indigo-600 text-white py-4 rounded-xl shadow-xl font-bold text-lg flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-70 disabled:scale-100 hover:bg-indigo-700"
              >
                {submitting ? (
                   <>
                     <svg className="animate-spin h-5 w-5 mr-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                       <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                       <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                     </svg>
                     儲存中...
                   </>
                ) : (
                   <>
                     <Save size={20} /> 儲存評分
                   </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* RANKING TAB */}
        {activeTab === 'ranking' && (
          <div className="animate-fade-in space-y-6">
            <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <button onClick={() => changeWeek(-1)} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200"><ChevronLeft size={20}/></button>
              <div className="text-center">
                <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">目前檢視</div>
                <div className="text-xl font-black text-indigo-900">{currentWeekLabel}</div>
              </div>
              <button onClick={() => changeWeek(1)} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200"><ChevronRight size={20}/></button>
            </div>

            {GRADES.map(grade => {
              const data = weeklyRankings[grade] || [];
              const top1 = data[0];
              const top2 = data[1];

              return (
                <div key={grade} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 p-3 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                      <span className="bg-indigo-600 text-white text-xs px-2 py-0.5 rounded">{grade} 年級</span>
                      總排行榜
                    </h3>
                    <span className="text-xs text-slate-400">本週累計</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 p-4 bg-gradient-to-b from-white to-slate-50">
                    {/* Winner */}
                    <div className="flex flex-col items-center relative mt-4">
                      <Trophy className="text-yellow-400 drop-shadow-sm absolute -top-6" size={32} fill="currentColor"/>
                      <div className="w-full bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 text-center shadow-sm relative z-10">
                        <div className="text-xs font-bold text-yellow-600 uppercase mb-1">第一名</div>
                        <div className="text-3xl font-black text-slate-800 mb-1">{top1 ? top1.classId : '-'}</div>
                        <div className="text-sm font-bold text-slate-500 bg-white/50 rounded-lg py-1">
                          {top1 ? `${top1.total > 0 ? '+' : ''}${top1.total}` : '--'} 分
                        </div>
                      </div>
                    </div>

                    {/* Runner Up */}
                    <div className="flex flex-col items-center relative mt-8">
                       <div className="absolute -top-5 bg-slate-200 text-slate-500 text-xs font-bold px-2 py-0.5 rounded-full border border-slate-300 z-20">第二名</div>
                       <div className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl p-4 text-center shadow-sm relative z-10">
                        <div className="text-2xl font-bold text-slate-700 mb-1 opacity-80">{top2 ? top2.classId : '-'}</div>
                         <div className="text-sm font-bold text-slate-400">
                          {top2 ? `${top2.total > 0 ? '+' : ''}${top2.total}` : '--'} 分
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-400 text-xs uppercase">
                         <tr>
                           <th className="p-2 text-left pl-4">排名</th>
                           <th className="p-2 text-left">班級</th>
                           <th className="p-2 text-right pr-4">總分</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.slice(2, 5).map((item, idx) => (
                          <tr key={item.classId}>
                            <td className="p-2 pl-4 font-bold text-slate-400">#{idx + 3}</td>
                            <td className="p-2 font-medium text-slate-600">{item.classId}</td>
                            <td className={`p-2 pr-4 text-right font-bold ${item.total >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {item.total > 0 ? '+' : ''}{item.total}
                            </td>
                          </tr>
                        ))}
                        {data.length > 5 && (
                          <tr><td colSpan="3" className="text-center p-2 text-xs text-slate-400 italic">僅顯示前 5 名</td></tr>
                        )}
                         {data.length === 0 && (
                          <tr><td colSpan="3" className="text-center p-6 text-slate-400">尚無資料</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <div className="animate-fade-in">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
               <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800">評分流水帳 (History)</h3>
                  <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded">{scoresData.length} 筆</span>
               </div>
               <div className="max-h-[60vh] overflow-y-auto">
                 <table className="w-full text-sm">
                   <thead className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                     <tr>
                       <th className="p-3 text-left">時間/班級</th>
                       <th className="p-3 text-left">項目</th>
                       <th className="p-3 text-right">分數</th>
                       <th className="p-3 w-10"></th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                     {scoresData.map(record => (
                       <tr key={record.id} className="hover:bg-slate-50 group">
                         <td className="p-3">
                           <div className="font-bold text-slate-700">{record.classId}</div>
                           <div className="text-xs text-slate-400">{record.date}</div>
                           {/* 顯示備註 */}
                           {record.note && (
                             <div className="mt-1 text-xs text-slate-500 flex items-start gap-1 bg-slate-50 p-1 rounded">
                                <MessageSquare size={10} className="mt-0.5 shrink-0"/>
                                <span>{record.note}</span>
                             </div>
                           )}
                         </td>
                         <td className="p-3">
                           <span className="bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-full border border-indigo-100">
                             {record.period}
                           </span>
                         </td>
                         <td className="p-3 text-right">
                           <span className={`font-bold ${record.score > 0 ? 'text-emerald-600' : (record.score < 0 ? 'text-red-600' : 'text-slate-400')}`}>
                             {record.score > 0 ? '+' : ''}{record.score}
                           </span>
                         </td>
                         <td className="p-3 text-center">
                            <button 
                              onClick={() => handleConfirmDelete(record.id)}
                              className="text-slate-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                         </td>
                       </tr>
                     ))}
                     {scoresData.length === 0 && (
                        <tr><td colSpan="4" className="p-8 text-center text-slate-400">無歷史資料</td></tr>
                     )}
                   </tbody>
                 </table>
               </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;