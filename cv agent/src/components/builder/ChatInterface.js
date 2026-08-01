'use colspan';
import React, { useState } from 'react';

export default function ChatInterface() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'أهلاً بك! أنا مساعد الذكاء الاصطناعي الخاص بك لتصميم السيرة الذاتية. ما هو اسمك الكامل لنبدأ؟' }
  ]);
  const [input, setInput] = useState('');

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    
    // محاكاة رد الذكاء الاصطناعي مؤقتاً
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'ممتاز! تليها تفاصيل الخبرة المهنية أو الدراسة؟' }
      ]);
    }, 1000);

    setInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '400px', border: '1px solid #ccc', borderRadius: '8px', padding: '16px', maxWidth: '500px', margin: '0 auto', background: '#fff' }}>
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {messages.map((msg, index) => (
          <div key={index} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', background: msg.role === 'user' ? '#0070f3' : '#e5e7eb', color: msg.role === 'user' ? '#fff' : '#000', padding: '8px 12px', borderRadius: '8px', maxWidth: '80%' }}>
            {msg.content}
          </div>
        ))}
      </div>
      <form onSubmit={handleSend} style={{ display: 'flex', gap: '8px' }}>
        <input 
          type="text" 
          value={input} 
          onChange={(e) => setInput(e.target.value)} 
          placeholder="اكتب ردك هنا..." 
          style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
        />
        <button type="submit" style={{ padding: '8px 16px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>إرسال</button>
      </form>
    </div>
  );
}