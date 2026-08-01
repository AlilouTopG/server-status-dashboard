'use client';
import { useState } from 'react';
import { extractCVData } from '../utils/cvParser';

export default function Home() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'أهلاً بك! أنا مساعد الذكاء الاصطناعي الخاص بك لتصميم السيرة الذاتية الاحترافية. ما هو اسمك الكامل لنبدأ؟' }
  ]);
  const [input, setInput] = useState('');
  const [step, setStep] = useState(0);
  const [cvData, setCvData] = useState({ fullName: '', profession: '', summary: '', skills: [], experience: '' });

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input;
    const newMessages = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setInput('');

    setTimeout(() => {
      const result = extractCVData(cvData, userMessage, step);
      setCvData(result.updatedData);
      setStep(result.nextStep);

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: result.responseMessage }
      ]);
    }, 500);
  };

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#f3f4f6', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '30px 20px', direction: 'rtl' }}>
      {/* رأس الصفحة */}
      <header style={{ maxWidth: '1200px', margin: '0 auto 30px auto', textAlign: 'center' }}>
        <h1 style={{ color: '#1f2937', fontSize: '28px', fontWeight: '800', marginBottom: '8px' }}>🚀 CV Agent - منصة الذكاء الاصطناعي للسيرة الذاتية</h1>
        <p style={{ color: '#4b5563', fontSize: '15px' }}>تحدث مع المساعد الذكي، وسيقوم بإنشاء وتنسيق سيرتك الذاتية فورياً بتصميم عصري واحترافي.</p>
      </header>

      {/* المحتوى الرئيسي */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '30px', maxWidth: '1200px', margin: '0 auto', justifyContent: 'center' }}>
        
        {/* قسم الشات التفاعلي */}
        <div style={{ flex: '1', minWidth: '320px', maxWidth: '500px', background: '#ffffff', borderRadius: '16px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)', display: 'flex', flexDirection: 'column', height: '600px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
          <div style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)', color: '#fff', padding: '16px 20px', fontWeight: 'bold', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            💬 محادثة المساعد الذكي
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', background: '#f9fafb' }}>
            {messages.map((msg, index) => (
              <div key={index} style={{ 
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
              }}>
                {msg.content}
              </div>
            ))}
          </div>

          <form onSubmit={handleSend} style={{ display: 'flex', padding: '16px', background: '#fff', borderTop: '1px solid #e5e7eb', gap: '10px' }}>
            <input 
              type="text" 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              placeholder="اكتب ردك هنا..." 
              style={{ flex: 1, padding: '12px 16px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', fontSize: '14px' }}
            />
            <button type="submit" style={{ padding: '0 20px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', transition: 'background 0.2s' }}>
              إرسال
            </button>
          </form>
        </div>

        {/* لوحة معاينة الـ CV الملونه والمنظمة */}
        <div style={{ flex: '1', minWidth: '350px', maxWidth: '550px', background: '#ffffff', borderRadius: '16px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)', display: 'flex', flexDirection: 'column', height: '600px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          
          <div style={{ background: '#1e293b', color: '#fff', padding: '16px 20px', fontWeight: 'bold', fontSize: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📄 معاينة السيرة الذاتية (Live Preview)</span>
            <span style={{ fontSize: '12px', background: '#10b981', padding: '4px 8px', borderRadius: '6px' }}>جاهز للتصدير</span>
          </div>

          {/* محتوى ورقة الـ CV */}
          <div style={{ flex: 1, padding: '24px', overflowY: 'auto', background: '#fff', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* رأس الـ CV */}
            <div style={{ borderBottom: '2px solid #4f46e5', paddingBottom: '16px' }}>
              <h2 style={{ margin: '0 0 6px 0', color: '#1e293b', fontSize: '22px' }}>{cvData.fullName || 'اسم المترشح'}</h2>
              <p style={{ margin: 0, color: '#4f46e5', fontWeight: '600', fontSize: '15px' }}>{cvData.profession || 'المسمى الوظيفي / التخصص'}</p>
            </div>

            {/* الملخص المهني */}
            {cvData.summary && (
              <div>
                <h4 style={{ margin: '0 0 6px 0', color: '#334155', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>النبذة المهنية</h4>
                <p style={{ margin: 0, color: '#475569', fontSize: '13.5px', lineHeight: '1.6', background: '#f8fafc', padding: '10px', borderRadius: '6px', borderLeft: '4px solid #4f46e5' }}>
                  {cvData.summary}
                </p>
              </div>
            )}

            {/* المهارات */}
            <div>
              <h4 style={{ margin: '0 0 8px 0', color: '#334155', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>المهارات التقنية والشخصية</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {cvData.skills.length > 0 ? (
                  cvData.skills.map((skill, i) => (
                    <span key={i} style={{ background: '#e0e7ff', color: '#3730a3', padding: '4px 10px', borderRadius: '6px', fontSize: '12.5px', fontWeight: '500' }}>
                      {skill}
                    </span>
                  ))
                ) : (
                  <span style={{ color: '#9ca3af', fontSize: '13px' }}>لم يتم إدخال المهارات بعد...</span>
                )}
              </div>
            </div>

            {/* الخبرات */}
            <div>
              <h4 style={{ margin: '0 0 6px 0', color: '#334155', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>الخبرات والمشاريع</h4>
              <p style={{ margin: 0, color: '#475569', fontSize: '13.5px', lineHeight: '1.5', background: '#f8fafc', padding: '10px', borderRadius: '6px', borderLeft: '4px solid #10b981' }}>
                {cvData.experience || 'لا توجد خبرات مسجلة حالياً...'}
              </p>
            </div>

          </div>

          {/* زر التصدير والطباعة السفلي */}
          <div style={{ padding: '16px', background: '#f8fafc', borderTop: '1px solid #e5e7eb' }}>
            <button 
              onClick={() => window.print()} 
              style={{ width: '100%', padding: '12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.2)' }}>
              🖨️ طباعة أو حفظ السيرة الذاتية (PDF)
            </button>
          </div>

        </div>

      </div>
    </main>
  );
}