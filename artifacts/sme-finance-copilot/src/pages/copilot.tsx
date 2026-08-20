import { Card, Badge, Button } from '@/components/ui';
import { useState } from 'react';
import { Search, MessageSquare, Bot, Clock, ChevronRight } from 'lucide-react';
import { useStore } from '@/lib/store';

export default function Copilot() {
  const { chatHistory, createChatSession, addChatMessage } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const activeSession = chatHistory.find(s => s.id === activeSessionId);
  
  const filteredHistory = chatHistory.filter(s => 
    s.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.messages.some(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleNewChat = () => {
    setActiveSessionId(null);
  };

  const handleSend = () => {
    if (!input.trim()) return;
    
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = createChatSession(input.slice(0, 30) + '...', { role: 'user', content: input, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
      setActiveSessionId(sessionId);
    } else {
      addChatMessage(sessionId, { role: 'user', content: input, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    }
    
    setInput('');
    setIsTyping(true);

    setTimeout(() => {
      addChatMessage(sessionId!, { 
        role: 'system', 
        content: "I'm a prototype companion. In a real scenario, I would look up your financial position and give a conservative answer, citing any assumptions I made.", 
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      setIsTyping(false);
    }, 1500);
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 h-[calc(100vh-6rem)] max-w-6xl mx-auto animate-in fade-in duration-500">
      {/* History Sidebar */}
      <div className="w-full md:w-80 flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-serif text-foreground">Copilot</h1>
          <p className="text-sm text-muted-foreground mt-1">Your financial companion and history.</p>
        </div>
        
        <Button onClick={handleNewChat} className="w-full justify-start gap-2 cursor-pointer" variant={!activeSessionId ? "default" : "outline"}>
          <MessageSquare className="w-4 h-4" /> New conversation
        </Button>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
          <input 
            type="text"
            placeholder="Search past conversations..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          {filteredHistory.map(session => (
            <button
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              className={`w-full text-left p-3 rounded-lg transition-colors cursor-pointer border ${
                activeSessionId === session.id 
                  ? 'bg-primary/5 border-primary ring-1 ring-primary/20' 
                  : 'bg-card border-border hover:bg-secondary/50'
              }`}
            >
              <div className="font-medium text-sm truncate">{session.title}</div>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" /> {session.date}
              </div>
            </button>
          ))}
          {filteredHistory.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No conversations found.</p>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <Card className="flex-1 flex flex-col min-h-0 border-border shadow-sm overflow-hidden bg-card">
        {activeSessionId && activeSession ? (
          <>
            <div className="p-4 border-b border-border bg-secondary/20">
              <h2 className="font-medium">{activeSession.title}</h2>
              <p className="text-xs text-muted-foreground">Started {activeSession.date}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-background">
              {activeSession.messages.map((msg) => (
                <div key={msg.id} className={`flex max-w-[85%] ${msg.role === 'user' ? 'ml-auto' : ''}`}>
                  <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user' 
                      ? 'bg-primary text-primary-foreground rounded-br-sm' 
                      : 'bg-secondary text-secondary-foreground rounded-bl-sm border border-border/50'
                  }`}>
                    {msg.role === 'system' && (
                      <div className="flex items-center gap-2 mb-2 text-primary font-medium text-xs pb-2 border-b border-border/10">
                        <Bot className="w-4 h-4" /> Finance Companion
                      </div>
                    )}
                    {msg.content}
                    <div className="text-[10px] mt-2 opacity-60 text-right">{msg.timestamp}</div>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex max-w-[85%]">
                  <div className="p-4 rounded-2xl bg-secondary text-secondary-foreground rounded-bl-sm border border-border/50">
                    <div className="flex gap-1 items-center h-4">
                      <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground bg-background">
            <Bot className="w-16 h-16 mb-4 text-primary opacity-20" />
            <h2 className="text-xl font-medium text-foreground mb-2">How can I help today?</h2>
            <p className="max-w-md text-sm">Ask a question about your financial position, tax estimates, or specific transactions. I'll use your verified context to give you accurate answers.</p>
            
            <div className="mt-8 grid grid-cols-1 gap-2 w-full max-w-md">
              <button 
                onClick={() => setInput('What is my estimated tax bill so far?')}
                className="p-3 text-sm text-left border border-border rounded-lg bg-card hover:bg-secondary/50 transition-colors flex justify-between items-center"
              >
                What is my estimated tax bill so far? <ChevronRight className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setInput('Can I expense my internet bill while working from home?')}
                className="p-3 text-sm text-left border border-border rounded-lg bg-card hover:bg-secondary/50 transition-colors flex justify-between items-center"
              >
                Can I expense my internet bill while working from home? <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="p-4 border-t border-border bg-card">
          <form 
            onSubmit={e => { e.preventDefault(); handleSend(); }}
            className="flex gap-3"
          >
            <input 
              type="text"
              placeholder="Ask a question..." 
              value={input}
              onChange={e => setInput(e.target.value)}
              className="flex-1 rounded-xl h-12 px-4 bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm"
            />
            <Button type="submit" size="default" className="h-12 px-6 rounded-xl cursor-pointer">
              Send
            </Button>
          </form>
          <div className="mt-3 text-center text-xs text-muted-foreground">
            Tax rules apply to standard UK scenarios. Always verify complex cases.
          </div>
        </div>
      </Card>
    </div>
  );
}