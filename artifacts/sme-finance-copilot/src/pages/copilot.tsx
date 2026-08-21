import { Card, Button, Input, Badge } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Plus, Search, MessageSquare, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/components/ui';

export default function Copilot() {
  const { chatHistory, addChatMessage, createChatSession, activeProfileId } = useStore();

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    chatHistory.length > 0 ? chatHistory[0].id : null
  );
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [search, setSearch] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const selectedSession = chatHistory.find(s => s.id === selectedSessionId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedSession?.messages, isTyping]);

  const handleNewSession = () => {
    const id = createChatSession('New conversation');
    setSelectedSessionId(id);
  };

  const handleSend = () => {
    if (!input.trim()) return;
    let sessionId = selectedSessionId;
    if (!sessionId) {
      sessionId = createChatSession(input.slice(0, 40));
      setSelectedSessionId(sessionId);
    }
    const userMsg = input;
    setInput('');
    addChatMessage(sessionId, { role: 'user', content: userMsg, timestamp: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) });
    setIsTyping(true);
    setTimeout(() => {
      addChatMessage(sessionId!, {
        role: 'system',
        content: "This is a demo response. When a live AI is connected, the intended flow is:\n\n1. Read your active profile's Financial Memory (position, transactions, Inbox)\n2. Apply relevant UK tax rules for the current period\n3. Reference your Decision Memory and benchmark data\n4. Give a sourced, conservative answer — with the calculation basis shown\n5. Flag unresolved items to the Inbox rather than guessing\n6. Clearly distinguish high-confidence answers from judgement calls",
        timestamp: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      });
      setIsTyping(false);
    }, 1500);
  };

  const starterQuestions = [
    'How much tax do I owe this year?',
    'What are my biggest tax-saving opportunities?',
    'Should I buy equipment before year end?',
    'How does my margin compare to similar businesses?',
  ];

  const filteredSessions = chatHistory.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    s.messages.some(m => m.content.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex h-[calc(100vh-12rem)] max-w-5xl mx-auto gap-0 border border-border rounded-xl overflow-hidden shadow-sm animate-in fade-in duration-500">
      {/* Sidebar */}
      <div className="w-64 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border space-y-3">
          <Button onClick={handleNewSession} className="w-full gap-2 cursor-pointer" size="sm">
            <Plus className="w-4 h-4" /> New conversation
          </Button>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search history..."
              className="h-8 text-xs pl-8"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredSessions.map(session => (
            <button
              key={session.id}
              onClick={() => setSelectedSessionId(session.id)}
              className={cn(
                "w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer",
                selectedSessionId === session.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="flex items-start gap-2">
                <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-medium truncate text-xs leading-tight">{session.title}</p>
                  <p className={cn("text-[10px] mt-0.5 flex items-center gap-1", selectedSessionId === session.id ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    <Clock className="w-2.5 h-2.5" /> {session.date}
                  </p>
                </div>
              </div>
            </button>
          ))}
          {filteredSessions.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">No conversations found.</p>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col bg-background min-w-0">
        {/* Chat header */}
        <div className="p-4 border-b border-border bg-card flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <span className="font-medium">{selectedSession?.title ?? 'Ask a question'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Demo mode — responses are mocked
            </Badge>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!selectedSession || selectedSession.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="space-y-2">
                <Bot className="w-10 h-10 text-primary/40 mx-auto" />
                <h3 className="font-medium text-foreground">What would you like to know?</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Ask about your finances, tax position, or business decisions.
                  When live AI is connected, responses will reference your Financial Memory and tax rules.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {starterQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(q)}
                    className="p-3 border border-border rounded-lg text-sm text-left hover:bg-secondary hover:border-primary/30 transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            selectedSession.messages.map((msg, i) => (
              <div key={i} className={cn("flex flex-col max-w-[80%]", msg.role === 'user' ? "ml-auto items-end" : "items-start")}>
                {msg.role === 'system' && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[10px] text-muted-foreground font-medium">Copilot</span>
                    <Badge className="text-[9px] bg-amber-100 text-amber-700 border-amber-200 py-0 px-1 h-4">Demo</Badge>
                    <span className="text-[10px] text-muted-foreground">{msg.timestamp}</span>
                  </div>
                )}
                {msg.role === 'user' && (
                  <span className="text-[10px] text-muted-foreground mb-1">{msg.timestamp}</span>
                )}
                <div className={cn(
                  "p-3.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap",
                  msg.role === 'user'
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-secondary text-secondary-foreground rounded-bl-sm"
                )}>
                  {msg.content}
                </div>
              </div>
            ))
          )}
          {isTyping && (
            <div className="flex items-start gap-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Bot className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="p-3 rounded-2xl bg-secondary text-secondary-foreground rounded-bl-sm flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" />
                <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border bg-card">
          <form onSubmit={e => { e.preventDefault(); handleSend(); }} className="flex gap-2">
            <Input
              placeholder="Ask about your finances, tax, or business decisions…"
              value={input}
              onChange={e => setInput(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" className="gap-2 cursor-pointer" disabled={!input.trim()}>
              <Send className="w-4 h-4" />
            </Button>
          </form>
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            Demo mode: responses are pre-written. When live AI is connected, answers will reference your actual Financial Memory.
          </p>
        </div>
      </div>
    </div>
  );
}
