import React, { useState, useEffect, useMemo } from 'react';
import { 
  ClipboardList, Trophy, Save, Calendar, Clock, 
  ChevronLeft, ChevronRight, Trash2, BarChart3, 
  School, CheckCircle2, AlertTriangle, Lock, Settings,
  MessageSquare, CalendarDays, Printer // 新增 Printer 圖標
} from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, doc, onSnapshot, 
  serverTimestamp, writeBatch, getDocs, query, orderBy, setDoc, limit 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
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

// 預設系統參數 (包含班級數與學期起訖)
const DEFAULT_SETTINGS = {
  classCounts: { 1: 4, 2: 5, 3: 5 },
  semesterStart: "2024-08-25", // 預設一個週日作為範例
  semesterEnd: "2025-01-20"
};

// Helper: 取得本地時區的今天日期字串 (YYYY-MM-DD)，確保台灣時間正確
const getLocalDateString = () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Helper: 將 YYYY-MM-DD 字串轉換為本地時區的 Date 物件 (午夜 00:00:00)
const parseLocalDate = (dateStr) => {
  if (!dateStr) return new Date();
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d); // JavaScript 月份是 0-11
};

// Helper: 計算某個日期屬於該學期的「第幾週」(星期日為一週之始)
const getSemesterWeek = (targetDateStr, startStr) => {
  if (!targetDateStr || !startStr) return 1;
  const target = parseLocalDate(targetDateStr);
  const start = parseLocalDate(startStr);
  
  // 找出「學期開始日」所在那一週的「星期日」作為第 1 週的起點
  const startSunday = new Date(start);
  startSunday.setDate(start.getDate() - start.getDay()); 
  
  // 找出「目標日」所在那一週的「星期日」
  const targetSunday = new Date(target);
  targetSunday.setDate(target.getDate() - target.getDay());
  
  // 計算兩個星期日相差幾週
  const diffTime = targetSunday.getTime() - startSunday.getTime();
  const diffWeeks = Math.round(diffTime / (7 * 24 * 60 * 60 * 1000));
  
  return diffWeeks + 1; // 加上 1 代表第一週
};

// Helper: 根據週次反推該週的起訖日期字串 (用於榮譽榜顯示)
const getWeekRangeString = (weekNum, startStr) => {
  if (!startStr) return "";
  const start = parseLocalDate(startStr);
  
  // 學期第一週的星期日
  const startSunday = new Date(start);
  startSunday.setDate(start.getDate() - start.getDay());
  
  // 目標週的星期日
  const targetSunday = new Date(startSunday);
  targetSunday.setDate(startSunday.getDate() + (weekNum - 1) * 7);
  
  // 目標週的星期六
  const targetSaturday = new Date(targetSunday);
  targetSaturday.setDate(targetSunday.getDate() + 6);
  
  const formatStr = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  return `第 ${weekNum} 週 (${formatStr(targetSunday)} ~ ${formatStr(targetSaturday)})`;
};

// Helper: 產生班級陣列
const generateClasses = (grade, counts) => 
  Array.from({ length: counts[grade] || 0 }, (_, i) => `${grade}${String(i + 1).padStart(2, '0')}`);


const App = () => {
  // --- State ---
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState('score');
  const [scoresData, setScoresData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Settings State (整合型)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [tempSettings, setTempSettings] = useState(DEFAULT_SETTINGS); 

  // UI Components State
  const [modalConfig, setModalConfig] = useState({ isOpen: false, type: '', title: '', message: '', onConfirm: null });
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminAction, setAdminAction] = useState(null); 

  // Scoring Form State
  const [selectedDate, setSelectedDate] = useState(getLocalDateString());
  const [selectedPeriod, setSelectedPeriod] = useState("早自修");
  const [selectedGrade, setSelectedGrade] = useState(1);
  const [currentScores, setCurrentScores] = useState({}); 
  const [feedback, setFeedback] = useState(""); 

  // Ranking View State (改為紀錄整數週次)
  const [viewWeekNum, setViewWeekNum] = useState(1);

  // --- Auth & Sync ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (e) {
        console.error("Auth Error:", e);
        showToast(`登入失敗`, 'error');
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Sync Settings Data (先載入設定)
  useEffect(() => {
    if (!authReady || !user) return;
    try {
      const docRef = doc(db, 'artifacts', APP_ID_PATH, 'public', 'data', SETTINGS_COLLECTION, SETTINGS_DOC_ID);
      const unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          // 若有舊設定，與預設值合併確保屬性完整
          const mergedSettings = { ...DEFAULT_SETTINGS, ...data };
          setSettings(mergedSettings);
          
          // 當設定載入完成，初始化目前畫面為「今天的週次」
          const currentWeek = getSemesterWeek(getLocalDateString(), mergedSettings.semesterStart);
          setViewWeekNum(currentWeek);
        } else {
           // 找不到設定時，預設現在這週
           setViewWeekNum(getSemesterWeek(getLocalDateString(), DEFAULT_SETTINGS.semesterStart));
        }
      });
      return () => unsubscribe();
    } catch (e) {
      console.error("Settings Sync Error:", e);
    }
  }, [authReady, user]);

  // Sync Scores Data
  useEffect(() => {
    if (!authReady || !user) return;
    const q = query(
      collection(db, 'artifacts', APP_ID_PATH, 'public', 'data', COLLECTION_NAME),
      orderBy('createdAt', 'desc'),
      limit(500) 
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setScoresData(data);
      setLoading(false);
    }, (error) => {
      setLoading(false);
    });
    return () => unsubscribe();
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
  
  // 計算評分頁面「選擇日期」當週的總分
  const currentWeekTotals = useMemo(() => {
    // 利用目標日期與設定檔，算出目標週次
    const selectedWeekNum = getSemesterWeek(selectedDate, settings.semesterStart); 
    
    // 過濾出同樣屬於該週次的歷史資料
    const filtered = scoresData.filter(d => getSemesterWeek(d.date, settings.semesterStart) === selectedWeekNum);
    const totals = {}; 
    
    GRADES.forEach(g => generateClasses(g, settings.classCounts).forEach(c => totals[c] = 0));
    filtered.forEach(record => {
      if (totals[record.classId] === undefined) totals[record.classId] = 0;
      totals[record.classId] += record.score;
    });
    return totals; 
  }, [scoresData, selectedDate, settings]);

  // 計算排行榜的資料 (加入平手判定機制與三連霸紀錄)
  const rankingStats = useMemo(() => {
    // 為了實作「歷史 tie-breaker」，必須從最舊的週次開始模擬計算到目前的 viewWeekNum
    const minWeek = Math.min(viewWeekNum, ...scoresData.map(d => getSemesterWeek(d.date, settings.semesterStart)), 1);
    const maxWeek = Math.max(viewWeekNum, ...scoresData.map(d => getSemesterWeek(d.date, settings.semesterStart)), 1);
    
    const rankingsMap = {};
    const history = {}; 

    // 初始化歷史紀錄
    GRADES.forEach(g => {
        history[g] = {};
        generateClasses(g, settings.classCounts).forEach(c => {
            history[g][c] = { firsts: 0, awards: 0, lastWeekFirst: false, streak: 0 };
        });
    });

    // 依序計算每週的排行榜，以建立穩定的歷史狀態 (涵蓋負數週次)
    for (let w = minWeek; w <= maxWeek; w++) {
        rankingsMap[w] = {};
        const weekRecords = scoresData.filter(d => getSemesterWeek(d.date, settings.semesterStart) === w);

        GRADES.forEach(g => {
            const gradeClasses = generateClasses(g, settings.classCounts);
            const totals = {};
            const earliestTimes = {}; 

            // 初始化
            gradeClasses.forEach(c => {
                totals[c] = 0;
                earliestTimes[c] = Infinity;
            });

            // 計算當週總分與最早加分時間
            weekRecords.forEach(r => {
                if (r.classId.startsWith(String(g))) {
                    totals[r.classId] += r.score;
                    if (r.score > 0 && r.createdAt) {
                        const time = r.createdAt.seconds || Infinity;
                        if (time < earliestTimes[r.classId]) {
                            earliestTimes[r.classId] = time;
                        }
                    }
                }
            });

            // 先依據總分進行分組
            const grouped = {};
            gradeClasses.forEach(c => {
                const score = totals[c];
                if (!grouped[score]) grouped[score] = [];
                grouped[score].push(c);
            });

            // 取得由大到小的分數陣列
            const sortedScores = Object.keys(grouped).map(Number).sort((a, b) => b - a);

            let currentRankIndex = 0; 
            const finalSortedClasses = [];

            sortedScores.forEach(score => {
                let tiedClasses = grouped[score];

                if (tiedClasses.length > 1) {
                    if (currentRankIndex === 0) {
                        tiedClasses.sort((a, b) => {
                            const histA = history[g][a] || { lastWeekFirst: false, firsts: 0 };
                            const histB = history[g][b] || { lastWeekFirst: false, firsts: 0 };
                            if (histA.lastWeekFirst !== histB.lastWeekFirst) return histA.lastWeekFirst ? -1 : 1;
                            if (histA.firsts !== histB.firsts) return histA.firsts - histB.firsts;
                            if (earliestTimes[a] !== earliestTimes[b]) return earliestTimes[a] - earliestTimes[b];
                            return a.localeCompare(b);
                        });
                    }
                    else if (currentRankIndex === 1) {
                        tiedClasses.sort((a, b) => {
                            const histA = history[g][a] || { awards: 0 };
                            const histB = history[g][b] || { awards: 0 };
                            if (histA.awards !== histB.awards) return histA.awards - histB.awards;
                            if (earliestTimes[a] !== earliestTimes[b]) return earliestTimes[a] - earliestTimes[b];
                            return a.localeCompare(b);
                        });
                    }
                    else {
                        tiedClasses.sort((a, b) => a.localeCompare(b));
                    }
                }

                tiedClasses.forEach(c => {
                    finalSortedClasses.push({
                        classId: c,
                        total: score
                    });
                    currentRankIndex++; 
                });
            });

            // 更新歷史紀錄供「下一週」的判定使用
            gradeClasses.forEach(c => {
                if (history[g][c]) {
                    history[g][c].lastWeekFirst = false;
                    if (finalSortedClasses.length === 0 || c !== finalSortedClasses[0].classId) {
                        history[g][c].streak = 0;
                    }
                }
            });

            if (finalSortedClasses.length > 0) {
                const top1 = finalSortedClasses[0].classId;
                if (history[g][top1]) {
                    history[g][top1].firsts += 1;
                    history[g][top1].awards += 1; 
                    history[g][top1].lastWeekFirst = true;
                    history[g][top1].streak += 1;
                    
                    if (history[g][top1].streak === 3) {
                        finalSortedClasses[0].isThreeWeekChamp = true;
                        history[g][top1].streak = 0; 
                    }
                }
            }
            if (finalSortedClasses.length > 1) {
                const top2 = finalSortedClasses[1].classId;
                if (history[g][top2]) {
                    history[g][top2].awards += 1; 
                }
            }

            // 致命錯誤修復：確保資料是存在各年級的屬性下，而不是覆蓋整個週次
            rankingsMap[w][g] = finalSortedClasses; 
        });
    }

    return {
        currentRankings: rankingsMap[viewWeekNum] || {},
        allRankings: rankingsMap,
        minAvailableWeek: minWeek, // 新增：輸出最小週次供列印表使用
        maxAvailableWeek: maxWeek
    };
  }, [scoresData, viewWeekNum, settings]);

  const currentRankings = rankingStats.currentRankings;
  const allRankings = rankingStats.allRankings;
  const minAvailableWeek = rankingStats.minAvailableWeek;
  const maxAvailableWeek = rankingStats.maxAvailableWeek;

  const currentWeekLabel = getWeekRangeString(viewWeekNum, settings.semesterStart);
  // 新增：計算「現實中」的今天是第幾週，用來作為提示
  const realCurrentWeek = getSemesterWeek(getLocalDateString(), settings.semesterStart);

  // --- Handlers ---
  const handleScoreChange = (classId, val) => {
    setCurrentScores(prev => ({ ...prev, [classId]: val }));
  };

  const handleConfirmSubmit = () => {
    if (!user) return showToast("系統尚未連線", 'error');
    if (Object.keys(currentScores).length === 0) return showToast("請至少評分一個班級", 'error');
    if (!selectedDate) return showToast("請選擇日期", 'error');

    // 防呆：檢查日期是否在學期範圍內 (可選，目前只做提醒)
    const selTime = parseLocalDate(selectedDate).getTime();
    const startTime = parseLocalDate(settings.semesterStart).getTime();
    const endTime = parseLocalDate(settings.semesterEnd).getTime();
    let warningMsg = "";
    if(selTime < startTime || selTime > endTime) {
        warningMsg = "\n(注意：此日期不在設定的學期範圍內！)";
    }

    setModalConfig({
      isOpen: true,
      type: 'confirm',
      title: '確認儲存',
      message: `確定要儲存 ${selectedDate} [${selectedPeriod}] 的評分嗎？${warningMsg}`,
      onConfirm: executeSubmit
    });
  };

  const executeSubmit = async () => {
    closeModal();
    setSubmitting(true);

    try {
      const batch = writeBatch(db);
      // 動態計算此次評分的週次並存入 (也可不用存，全靠 date 即時計算，但存起來可以做為雙重參考)
      const weekNum = getSemesterWeek(selectedDate, settings.semesterStart);
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
            weekIndex: weekNum, // 新增紀錄整數週次
            period: selectedPeriod,
            grade: gradeNum,
            classId: String(classId),
            score: scoreNum,
            note: feedback.trim(), 
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
        setFeedback(""); 
      } else {
        showToast("沒有有效的評分數據", 'error');
      }
    } catch (e) {
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
    
    if (adminAction === 'CLEAR_HISTORY') {
      confirmClearHistory();
    } else if (adminAction === 'OPEN_SETTINGS') {
      setTempSettings({...settings}); // 載入目前設定供編輯
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
          showToast(`清空失敗`, 'error');
        } finally {
          setSubmitting(false);
        }
      }
    });
  };

  const saveSettings = async () => {
    if(!tempSettings.semesterStart || !tempSettings.semesterEnd) {
      return showToast("請完整填寫學期起訖日期", "error");
    }
    
    setShowSettingsModal(false);
    setSubmitting(true);
    try {
        const docRef = doc(db, 'artifacts', APP_ID_PATH, 'public', 'data', SETTINGS_COLLECTION, SETTINGS_DOC_ID);
        await setDoc(docRef, tempSettings, { merge: true });
        showToast("系統設定已更新", 'success');
    } catch(e) {
        showToast(`設定儲存失敗: ${e.message}`, 'error');
    } finally {
        setSubmitting(false);
    }
  };

  // 變更觀看的週次
  const changeWeek = (delta) => {
    setViewWeekNum(prev => prev + delta);
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
    <>
    {/* 列印專用的全域樣式 */}
    <style>{`
      @media print {
        body { background: white !important; margin: 0; padding: 0; }
        .no-print { display: none !important; }
        .print-only { display: block !important; }
        @page { margin: 15mm; }
      }
    `}</style>

    <div className="min-h-screen bg-slate-100 font-sans text-slate-800 pb-20 relative no-print">
      
      {/* Custom Modal Overlay */}
      {modalConfig.isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden transform transition-all scale-100">
            <div className={`p-4 ${modalConfig.type === 'delete' ? 'bg-red-50' : 'bg-indigo-50'} border-b border-slate-100 flex items-center gap-3`}>
              {modalConfig.type === 'delete' ? <AlertTriangle className="text-red-500"/> : <CheckCircle2 className="text-indigo-500"/>}
              <h3 className="font-bold text-lg text-slate-800">{modalConfig.title}</h3>
            </div>
            <div className="p-6">
              <p className="text-slate-600 font-medium whitespace-pre-line">{modalConfig.message}</p>
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

      {/* Settings Modal - 新增學期起訖 */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden max-h-[90vh] overflow-y-auto">
             <div className="p-4 bg-slate-800 text-white flex items-center gap-2 sticky top-0 z-10">
              <Settings size={20}/>
              <h3 className="font-bold">系統參數設定</h3>
            </div>
            <div className="p-6 space-y-6">
              
              {/* 學期設定 */}
              <div>
                <h4 className="font-bold text-slate-700 flex items-center gap-2 mb-3 border-b border-slate-100 pb-2">
                   <CalendarDays size={18}/> 學期日期區間
                </h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">學期開始日期 (作為第1週起點)</label>
                    <input 
                      type="date" 
                      value={tempSettings.semesterStart}
                      onChange={(e) => setTempSettings(prev => ({...prev, semesterStart: e.target.value}))}
                      className="w-full p-2 border border-slate-300 rounded bg-slate-50 outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">學期結束日期</label>
                    <input 
                      type="date" 
                      value={tempSettings.semesterEnd}
                      onChange={(e) => setTempSettings(prev => ({...prev, semesterEnd: e.target.value}))}
                      className="w-full p-2 border border-slate-300 rounded bg-slate-50 outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* 班級數量設定 */}
              <div>
                 <h4 className="font-bold text-slate-700 flex items-center gap-2 mb-3 border-b border-slate-100 pb-2">
                   <School size={18}/> 各年級班級總數
                 </h4>
                <div className="space-y-3">
                  {GRADES.map(grade => (
                    <div key={grade} className="flex items-center justify-between">
                      <label className="font-bold text-slate-600">{grade} 年級</label>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setTempSettings(prev => ({
                            ...prev, 
                            classCounts: {...prev.classCounts, [grade]: Math.max(1, (prev.classCounts[grade] || 0) - 1)}
                          }))}
                          className="w-8 h-8 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"
                        >-</button>
                        <span className="w-12 text-center font-bold text-lg">{tempSettings.classCounts[grade]} 班</span>
                        <button 
                          onClick={() => setTempSettings(prev => ({
                            ...prev, 
                            classCounts: {...prev.classCounts, [grade]: Math.min(20, (prev.classCounts[grade] || 0) + 1)}
                          }))}
                          className="w-8 h-8 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"
                        >+</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-xs text-slate-400 bg-yellow-50 p-3 rounded border border-yellow-100">
                注意：減少班級數將隱藏該班級，但歷史數據保留。變更學期開始日會重新計算所有榮譽榜的週次。
              </div>
            </div>
            <div className="p-4 bg-slate-50 flex gap-3 sticky bottom-0 border-t border-slate-100">
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
              {generateClasses(selectedGrade, settings.classCounts).map(classId => (
                <ClassScoreRow 
                  key={classId} 
                  classId={classId} 
                  currentWeekTotal={currentWeekTotals[classId] || 0} 
                />
              ))}
            </div>

            {/* 反映事項 (Feedback Input) */}
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
            <div className="flex flex-col sm:flex-row items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-slate-200 gap-3">
              <button onClick={() => changeWeek(-1)} className="p-2 w-full sm:w-auto bg-slate-100 rounded hover:bg-slate-200 flex justify-center"><ChevronLeft size={20}/></button>
              <div className="text-center flex flex-col items-center">
                <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">目前檢視</div>
                <div className="text-lg sm:text-xl font-black text-indigo-900 bg-indigo-50 px-4 py-1 rounded-full mb-2">{currentWeekLabel}</div>
                {/* 新增：提示本週是第幾週 */}
                <div className="text-xs font-bold text-slate-500 bg-slate-50 inline-block px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                  💡 提示：本週是第 {realCurrentWeek} 週
                </div>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button 
                  onClick={() => window.print()} 
                  className="flex-1 sm:flex-none p-2 bg-slate-800 text-white rounded hover:bg-slate-700 flex justify-center items-center gap-1 text-sm font-bold shadow"
                >
                  <Printer size={16}/> 列印
                </button>
                <button onClick={() => changeWeek(1)} className="flex-1 sm:flex-none p-2 bg-slate-100 rounded hover:bg-slate-200 flex justify-center"><ChevronRight size={20}/></button>
              </div>
            </div>

            {GRADES.map(grade => {
              const data = currentRankings[grade] || [];
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
                      {top1?.isThreeWeekChamp && (
                        <div className="absolute -top-11 left-1/2 -translate-x-1/2 bg-red-500 text-white text-xs font-black px-3 py-1.5 rounded-full shadow-lg border-2 border-red-200 animate-bounce whitespace-nowrap z-30 flex items-center gap-1 tracking-widest">
                           🔥 三連霸
                        </div>
                      )}
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
                       <th className="p-3 text-left w-24 sm:w-auto">時間/班級</th>
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
                           <div className="text-xs text-slate-400">
                             {record.date} 
                             <span className="ml-1 hidden sm:inline-block bg-slate-100 text-slate-400 px-1 rounded text-[10px]">
                               W{getSemesterWeek(record.date, settings.semesterStart)}
                             </span>
                           </div>
                           {record.note && (
                             <div className="mt-1 text-xs text-slate-500 flex items-start gap-1 bg-slate-50 p-1 rounded">
                                <MessageSquare size={10} className="mt-0.5 shrink-0"/>
                                <span>{record.note}</span>
                             </div>
                           )}
                         </td>
                         <td className="p-3">
                           <span className="bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-full border border-indigo-100 whitespace-nowrap">
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

    {/* 列印專用排版 (平時隱藏，僅在列印時顯示) */}
    <div className="hidden print:block print-only absolute top-0 left-0 w-full bg-white text-black p-8">
       <h1 className="text-3xl font-black text-center mb-6 border-b-2 border-black pb-4">校園秩序評分榮譽榜</h1>
       
       <h2 className="text-2xl font-bold mb-4">{currentWeekLabel} - 當週得獎名單</h2>
       <table className="w-full border-collapse border-2 border-black mb-10 text-center text-lg">
         <thead>
           <tr className="bg-gray-100">
             <th className="border border-black p-3 w-1/3">年級</th>
             <th className="border border-black p-3 w-1/3">第一名</th>
             <th className="border border-black p-3 w-1/3">第二名</th>
           </tr>
         </thead>
         <tbody>
           {GRADES.map(grade => {
             const data = currentRankings[grade] || [];
             const top1 = data[0];
             const top2 = data[1];
             return (
               <tr key={grade}>
                 <td className="border border-black p-3 font-bold bg-gray-50">{grade} 年級</td>
                 <td className="border border-black p-3 font-bold text-red-600">
                   {top1 ? top1.classId : '-'}
                   {top1?.isThreeWeekChamp && <span className="ml-2 text-xs bg-red-100 text-red-600 px-1 border border-red-300 rounded">三連霸</span>}
                 </td>
                 <td className="border border-black p-3 font-medium">{top2 ? top2.classId : '-'}</td>
               </tr>
             );
           })}
         </tbody>
       </table>

       <h2 className="text-2xl font-bold mb-4">本學期各週紀錄 (精簡彙整)</h2>
       <table className="w-full border-collapse border border-black text-center">
         <thead>
           <tr className="bg-gray-100">
             <th className="border border-black p-2 w-24">週次</th>
             <th className="border border-black p-2">一年級 (一 / 二)</th>
             <th className="border border-black p-2">二年級 (一 / 二)</th>
             <th className="border border-black p-2">三年級 (一 / 二)</th>
           </tr>
         </thead>
         <tbody>
           {Array.from({ length: maxAvailableWeek - minAvailableWeek + 1 }, (_, i) => i + minAvailableWeek).map(w => (
             <tr key={w}>
               <td className="border border-black p-2 font-bold whitespace-nowrap bg-gray-50">第 {w} 週</td>
               {GRADES.map(g => {
                 const wData = allRankings[w]?.[g] || [];
                 const t1 = wData[0] ? wData[0].classId : '-';
                 const t2 = wData[1] ? wData[1].classId : '-';
                 const is3Win = wData[0]?.isThreeWeekChamp;
                 return (
                   <td key={g} className="border border-black p-2">
                     <span className="font-bold text-red-600">{t1}</span> {is3Win && <span className="text-[10px] text-red-500">(三連霸)</span>} / <span>{t2}</span>
                   </td>
                 );
               })}
             </tr>
           ))}
         </tbody>
       </table>
    </div>
    </>
  );
};

export default App;