module.exports = [
"[project]/cv agent/src/utils/cvParser.js [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// دالة متقدمة لتحليل وإثراء بيانات السيرة الذاتية تدريجياً
__turbopack_context__.s([
    "extractCVData",
    ()=>extractCVData
]);
function extractCVData(currentData, userMessage, step) {
    let updatedData = {
        ...currentData
    };
    let nextStep = step;
    let responseMessage = "";
    switch(step){
        case 0:
            updatedData.fullName = userMessage;
            nextStep = 1;
            responseMessage = `أهلاً بك يا ${userMessage}! ما هو تخصصك الدراسي أو مجالك المهني الحالي؟ (مثال: طالب جامعي، مطور برمجيات، مصمم...)`;
            break;
        case 1:
            {
                // إثراء ذكي للمهنة والتخصص بناءً على المدخلات البسيطة للمستخدم
                let enhancedProfession = userMessage;
                let extraSummary = "";
                if (userMessage.includes("طالب") || userMessage.includes("جامعة")) {
                    enhancedProfession = `${userMessage} طموح ومجتهد، شغوف باكتساب خبرات جديدة وتطوير مهاراته الأكاديمية والعملية.`;
                    extraSummary = "طالب جامعي متحفز للتعلم، قادر على العمل ضمن فريق وإدارة المشاريع بكفاءة.";
                } else if (userMessage.includes("برمج") || userMessage.includes("مطور") || userMessage.includes("developer")) {
                    enhancedProfession = `${userMessage} محترف، يمتلك عقلية تحليلية وقدرة عالية على حل المشكلات التقنية وبناء تطبيقات حديثة.`;
                    extraSummary = "مطور برمجيات ترتكز اهتماماته على كتابة كود نظيف وقابل للتوسع.";
                } else {
                    enhancedProfession = userMessage;
                    extraSummary = "محترف متفانٍ في عمله، يسعى دائماً لتقديم أفضل أداء وتحقيق أهداف المؤسسة.";
                }
                updatedData.profession = enhancedProfession;
                updatedData.summary = extraSummary;
                nextStep = 2;
                responseMessage = "ممتاز! تم توليد نبذة تعريفية مهنية تلقائياً بناءً على إجابتك. الآن، اذكر لي أبرز مهاراتك (افصل بينها بفواصل):";
                break;
            }
        case 2:
            updatedData.skills = userMessage.split(',').map((s)=>s.trim());
            nextStep = 3;
            responseMessage = "رائع جداً! هل لديك خبرات عمل أو مشاريع سابقة؟ (اكتب باختصار أو اكتب 'لا يوجد'):";
            break;
        case 3:
            updatedData.experience = userMessage;
            nextStep = 4;
            responseMessage = "تم إكمال جمع وإثراء معلومات سيرتك الذاتية بنجاح! يمكنك الآن مراجعتها ومعاينتها بالكامل.";
            break;
        default:
            responseMessage = "لقد أكملنا جمع البيانات وتوليد السيرة الذاتية بنجاح!";
    }
    return {
        updatedData,
        nextStep,
        responseMessage
    };
}
}),
"[project]/cv agent/src/app/page.js [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Home
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cv agent/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cv agent/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$src$2f$utils$2f$cvParser$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cv agent/src/utils/cvParser.js [app-ssr] (ecmascript)");
'use client';
;
;
;
function Home() {
    const [messages, setMessages] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])([
        {
            role: 'assistant',
            content: 'أهلاً بك! أنا مساعد الذكاء الاصطناعي الخاص بك لتصميم السيرة الذاتية الاحترافية. ما هو اسمك الكامل لنبدأ؟'
        }
    ]);
    const [input, setInput] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])('');
    const [step, setStep] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(0);
    const [cvData, setCvData] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])({
        fullName: '',
        profession: '',
        summary: '',
        skills: [],
        experience: ''
    });
    const handleSend = (e)=>{
        e.preventDefault();
        if (!input.trim()) return;
        const userMessage = input;
        const newMessages = [
            ...messages,
            {
                role: 'user',
                content: userMessage
            }
        ];
        setMessages(newMessages);
        setInput('');
        setTimeout(()=>{
            const result = (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$src$2f$utils$2f$cvParser$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["extractCVData"])(cvData, userMessage, step);
            setCvData(result.updatedData);
            setStep(result.nextStep);
            setMessages((prev)=>[
                    ...prev,
                    {
                        role: 'assistant',
                        content: result.responseMessage
                    }
                ]);
        }, 500);
    };
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("main", {
        style: {
            minHeight: '100vh',
            backgroundColor: '#f3f4f6',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '30px 20px',
            direction: 'rtl'
        },
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("header", {
                style: {
                    maxWidth: '1200px',
                    margin: '0 auto 30px auto',
                    textAlign: 'center'
                },
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                        style: {
                            color: '#1f2937',
                            fontSize: '28px',
                            fontWeight: '800',
                            marginBottom: '8px'
                        },
                        children: "🚀 CV Agent - منصة الذكاء الاصطناعي للسيرة الذاتية"
                    }, void 0, false, {
                        fileName: "[project]/cv agent/src/app/page.js",
                        lineNumber: 38,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        style: {
                            color: '#4b5563',
                            fontSize: '15px'
                        },
                        children: "تحدث مع المساعد الذكي، وسيقوم بإنشاء وتنسيق سيرتك الذاتية فورياً بتصميم عصري واحترافي."
                    }, void 0, false, {
                        fileName: "[project]/cv agent/src/app/page.js",
                        lineNumber: 39,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/cv agent/src/app/page.js",
                lineNumber: 37,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                style: {
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '30px',
                    maxWidth: '1200px',
                    margin: '0 auto',
                    justifyContent: 'center'
                },
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        style: {
                            flex: '1',
                            minWidth: '320px',
                            maxWidth: '500px',
                            background: '#ffffff',
                            borderRadius: '16px',
                            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                            display: 'flex',
                            flexDirection: 'column',
                            height: '600px',
                            overflow: 'hidden',
                            border: '1px solid #e5e7eb'
                        },
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                style: {
                                    background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
                                    color: '#fff',
                                    padding: '16px 20px',
                                    fontWeight: 'bold',
                                    fontSize: '16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                },
                                children: "💬 محادثة المساعد الذكي"
                            }, void 0, false, {
                                fileName: "[project]/cv agent/src/app/page.js",
                                lineNumber: 47,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                style: {
                                    flex: 1,
                                    overflowY: 'auto',
                                    padding: '20px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '12px',
                                    background: '#f9fafb'
                                },
                                children: messages.map((msg, index)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        style: {
                                            alignSelf: msg.role === 'user' ? 'flex-start' : 'flex-end',
                                            background: msg.role === 'user' ? '#4f46e5' : '#ffffff',
                                            color: msg.role === 'user' ? '#fff' : '#1f2937',
                                            padding: '12px 16px',
                                            borderRadius: '12px',
                                            maxWidth: '85%',
                                            boxShadow: msg.role === 'assistant' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                                            border: msg.role === 'assistant' ? '1px solid #e5e7eb' : 'none',
                                            fontSize: '14px',
                                            lineHeight: '1.5'
                                        },
                                        children: msg.content
                                    }, index, false, {
                                        fileName: "[project]/cv agent/src/app/page.js",
                                        lineNumber: 53,
                                        columnNumber: 15
                                    }, this))
                            }, void 0, false, {
                                fileName: "[project]/cv agent/src/app/page.js",
                                lineNumber: 51,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("form", {
                                onSubmit: handleSend,
                                style: {
                                    display: 'flex',
                                    padding: '16px',
                                    background: '#fff',
                                    borderTop: '1px solid #e5e7eb',
                                    gap: '10px'
                                },
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                        type: "text",
                                        value: input,
                                        onChange: (e)=>setInput(e.target.value),
                                        placeholder: "اكتب ردك هنا...",
                                        style: {
                                            flex: 1,
                                            padding: '12px 16px',
                                            borderRadius: '8px',
                                            border: '1px solid #d1d5db',
                                            outline: 'none',
                                            fontSize: '14px'
                                        }
                                    }, void 0, false, {
                                        fileName: "[project]/cv agent/src/app/page.js",
                                        lineNumber: 71,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                        type: "submit",
                                        style: {
                                            padding: '0 20px',
                                            background: '#4f46e5',
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            fontWeight: 'bold',
                                            fontSize: '14px',
                                            transition: 'background 0.2s'
                                        },
                                        children: "إرسال"
                                    }, void 0, false, {
                                        fileName: "[project]/cv agent/src/app/page.js",
                                        lineNumber: 78,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/cv agent/src/app/page.js",
                                lineNumber: 70,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/cv agent/src/app/page.js",
                        lineNumber: 46,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        style: {
                            flex: '1',
                            minWidth: '350px',
                            maxWidth: '550px',
                            background: '#ffffff',
                            borderRadius: '16px',
                            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                            display: 'flex',
                            flexDirection: 'column',
                            height: '600px',
                            border: '1px solid #e5e7eb',
                            overflow: 'hidden'
                        },
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                style: {
                                    background: '#1e293b',
                                    color: '#fff',
                                    padding: '16px 20px',
                                    fontWeight: 'bold',
                                    fontSize: '16px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                },
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        children: "📄 معاينة السيرة الذاتية (Live Preview)"
                                    }, void 0, false, {
                                        fileName: "[project]/cv agent/src/app/page.js",
                                        lineNumber: 88,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        style: {
                                            fontSize: '12px',
                                            background: '#10b981',
                                            padding: '4px 8px',
                                            borderRadius: '6px'
                                        },
                                        children: "جاهز للتصدير"
                                    }, void 0, false, {
                                        fileName: "[project]/cv agent/src/app/page.js",
                                        lineNumber: 89,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/cv agent/src/app/page.js",
                                lineNumber: 87,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                style: {
                                    flex: 1,
                                    padding: '24px',
                                    overflowY: 'auto',
                                    background: '#fff',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '20px'
                                },
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        style: {
                                            borderBottom: '2px solid #4f46e5',
                                            paddingBottom: '16px'
                                        },
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                                                style: {
                                                    margin: '0 0 6px 0',
                                                    color: '#1e293b',
                                                    fontSize: '22px'
                                                },
                                                children: cvData.fullName || 'اسم المترشح'
                                            }, void 0, false, {
                                                fileName: "[project]/cv agent/src/app/page.js",
                                                lineNumber: 97,
                                                columnNumber: 15
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                                style: {
                                                    margin: 0,
                                                    color: '#4f46e5',
                                                    fontWeight: '600',
                                                    fontSize: '15px'
                                                },
                                                children: cvData.profession || 'المسمى الوظيفي / التخصص'
                                            }, void 0, false, {
                                                fileName: "[project]/cv agent/src/app/page.js",
                                                lineNumber: 98,
                                                columnNumber: 15
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/cv agent/src/app/page.js",
                                        lineNumber: 96,
                                        columnNumber: 13
                                    }, this),
                                    cvData.summary && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h4", {
                                                style: {
                                                    margin: '0 0 6px 0',
                                                    color: '#334155',
                                                    fontSize: '14px',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px'
                                                },
                                                children: "النبذة المهنية"
                                            }, void 0, false, {
                                                fileName: "[project]/cv agent/src/app/page.js",
                                                lineNumber: 104,
                                                columnNumber: 17
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                                style: {
                                                    margin: 0,
                                                    color: '#475569',
                                                    fontSize: '13.5px',
                                                    lineHeight: '1.6',
                                                    background: '#f8fafc',
                                                    padding: '10px',
                                                    borderRadius: '6px',
                                                    borderLeft: '4px solid #4f46e5'
                                                },
                                                children: cvData.summary
                                            }, void 0, false, {
                                                fileName: "[project]/cv agent/src/app/page.js",
                                                lineNumber: 105,
                                                columnNumber: 17
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/cv agent/src/app/page.js",
                                        lineNumber: 103,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h4", {
                                                style: {
                                                    margin: '0 0 8px 0',
                                                    color: '#334155',
                                                    fontSize: '14px',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px'
                                                },
                                                children: "المهارات التقنية والشخصية"
                                            }, void 0, false, {
                                                fileName: "[project]/cv agent/src/app/page.js",
                                                lineNumber: 113,
                                                columnNumber: 15
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                style: {
                                                    display: 'flex',
                                                    flexWrap: 'wrap',
                                                    gap: '6px'
                                                },
                                                children: cvData.skills.length > 0 ? cvData.skills.map((skill, i)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                        style: {
                                                            background: '#e0e7ff',
                                                            color: '#3730a3',
                                                            padding: '4px 10px',
                                                            borderRadius: '6px',
                                                            fontSize: '12.5px',
                                                            fontWeight: '500'
                                                        },
                                                        children: skill
                                                    }, i, false, {
                                                        fileName: "[project]/cv agent/src/app/page.js",
                                                        lineNumber: 117,
                                                        columnNumber: 21
                                                    }, this)) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    style: {
                                                        color: '#9ca3af',
                                                        fontSize: '13px'
                                                    },
                                                    children: "لم يتم إدخال المهارات بعد..."
                                                }, void 0, false, {
                                                    fileName: "[project]/cv agent/src/app/page.js",
                                                    lineNumber: 122,
                                                    columnNumber: 19
                                                }, this)
                                            }, void 0, false, {
                                                fileName: "[project]/cv agent/src/app/page.js",
                                                lineNumber: 114,
                                                columnNumber: 15
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/cv agent/src/app/page.js",
                                        lineNumber: 112,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h4", {
                                                style: {
                                                    margin: '0 0 6px 0',
                                                    color: '#334155',
                                                    fontSize: '14px',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px'
                                                },
                                                children: "الخبرات والمشاريع"
                                            }, void 0, false, {
                                                fileName: "[project]/cv agent/src/app/page.js",
                                                lineNumber: 129,
                                                columnNumber: 15
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                                style: {
                                                    margin: 0,
                                                    color: '#475569',
                                                    fontSize: '13.5px',
                                                    lineHeight: '1.5',
                                                    background: '#f8fafc',
                                                    padding: '10px',
                                                    borderRadius: '6px',
                                                    borderLeft: '4px solid #10b981'
                                                },
                                                children: cvData.experience || 'لا توجد خبرات مسجلة حالياً...'
                                            }, void 0, false, {
                                                fileName: "[project]/cv agent/src/app/page.js",
                                                lineNumber: 130,
                                                columnNumber: 15
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/cv agent/src/app/page.js",
                                        lineNumber: 128,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/cv agent/src/app/page.js",
                                lineNumber: 93,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                style: {
                                    padding: '16px',
                                    background: '#f8fafc',
                                    borderTop: '1px solid #e5e7eb'
                                },
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cv__agent$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                    onClick: ()=>window.print(),
                                    style: {
                                        width: '100%',
                                        padding: '12px',
                                        background: '#10b981',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '8px',
                                        cursor: 'pointer',
                                        fontWeight: 'bold',
                                        fontSize: '14px',
                                        boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.2)'
                                    },
                                    children: "🖨️ طباعة أو حفظ السيرة الذاتية (PDF)"
                                }, void 0, false, {
                                    fileName: "[project]/cv agent/src/app/page.js",
                                    lineNumber: 139,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/cv agent/src/app/page.js",
                                lineNumber: 138,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/cv agent/src/app/page.js",
                        lineNumber: 85,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/cv agent/src/app/page.js",
                lineNumber: 43,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/cv agent/src/app/page.js",
        lineNumber: 35,
        columnNumber: 5
    }, this);
}
}),
"[project]/cv agent/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/cv agent/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['react-ssr'].ReactJsxDevRuntime;
}),
];

//# sourceMappingURL=cv%20agent_1armcrx._.js.map