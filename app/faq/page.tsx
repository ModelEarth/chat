import Link from "next/link";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
// @ts-ignore — yaml v2 ships its own types; tsconfig moduleResolution doesn't resolve them
import { parse } from "yaml";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import { VercelIcon } from "@/components/icons";
import {
    Key,
    Shield,
    Zap,
    Users,
    Globe,
    Sparkles,
    CheckCircle2
} from "lucide-react";

type ChatSite = { title: string; url: string; description?: string };

function getChatSites(): ChatSite[] {
    try {
        const candidates = [
            resolve(process.cwd(), "chatsites.yaml"),
            resolve(process.cwd(), "../chatsites.yaml"),
        ];
        const filePath = candidates.find((p) => existsSync(p));
        if (!filePath) return [];
        const raw = readFileSync(filePath, "utf-8");
        const data = parse(raw) as { sites?: ChatSite[] };
        return data?.sites ?? [];
    } catch {
        return [];
    }
}

export default function FAQPage() {
    const faqs = [
        {
            category: "Bring your own keys",
            icon: Key,
            gradient: "from-green-500 to-emerald-500",
            questions: [
                {
                    q: "Is AI Chatbot really free?",
                    a: "Yes! Our platform is completely free to use. You only need to bring your own API keys from providers like Google, OpenAI, or Anthropic. We don't charge any subscription fees or usage costs."
                },
                {
                    q: "Why is it free?",
                    a: "We believe AI should be accessible to everyone. By using your own API keys, you pay the AI providers directly at their cost, and we don't need to mark up prices or charge subscription fees. This keeps the service free and transparent."
                },
                {
                    q: "What are API keys and how do I get them?",
                    a: "API keys are credentials that allow you to access AI services. You can get them from providers like Google AI Studio (free tier available), OpenAI, or Anthropic. Simply sign up with the provider, generate an API key, and add it to your account settings."
                },
                {
                    q: "How much do API keys cost?",
                    a: "It varies by provider. Google offers a generous free tier, OpenAI charges per token (typically $0.002-$0.03 per 1K tokens), and Anthropic has similar pricing. Most users spend less than $5-10/month for regular use."
                }
            ]
        },
        {
            category: "Security & Privacy",
            icon: Shield,
            gradient: "from-blue-500 to-cyan-500",
            questions: [
                {
                    q: "How secure are my API keys?",
                    a: "Your API keys are encrypted at rest using industry-standard AES-256 encryption and stored securely in our database. They're only decrypted when making API calls on your behalf and are never logged or shared."
                },
                {
                    q: "Do you store my conversations?",
                    a: "Yes, conversations are stored to provide you with chat history and context. However, they're encrypted and only accessible to you. We never use your data for training AI models or share it with third parties."
                },
                {
                    q: "Can I delete my data?",
                    a: "Absolutely! You can delete individual conversations or your entire account at any time from the settings page. All associated data will be permanently removed from our systems."
                },
                {
                    q: "Is my data shared with AI providers?",
                    a: "When you use AI features, your prompts are sent to the respective AI provider (Google, OpenAI, etc.) using your API key. We recommend reviewing each provider's privacy policy. Most providers don't use API data for training."
                }
            ]
        },
        {
            category: "Features & Usage",
            icon: Zap,
            gradient: "from-purple-500 to-pink-500",
            questions: [
                {
                    q: "What AI models can I use?",
                    a: "You can use any model supported by your API provider, including GPT-4, GPT-3.5, Claude, Gemini Pro, and more. Simply configure your preferred model in the settings."
                },
                {
                    q: "Can I upload files and documents?",
                    a: "Yes! Our Document Processing Agent supports PDFs, text files, and various document formats. You can upload files and ask questions about their content."
                },
                {
                    q: "Does it support code execution?",
                    a: "Yes! The Python Execution Agent allows you to run Python code securely in a sandboxed environment. Perfect for data analysis, calculations, and automation."
                },
                {
                    q: "Can I create diagrams and visualizations?",
                    a: "Absolutely! The Mermaid Diagram Agent can generate flowcharts, sequence diagrams, class diagrams, and more from simple text descriptions."
                },
                {
                    q: "Is there a mobile app?",
                    a: "Currently, we're web-based and fully responsive, working great on mobile browsers. A dedicated mobile app is on our roadmap for future development."
                }
            ]
        },
        {
            category: "Account & Setup",
            icon: Users,
            gradient: "from-orange-500 to-red-500",
            questions: [
                {
                    q: "How do I get started?",
                    a: "Simply sign up for a free account, verify your email, and add your API keys in the settings. You'll be chatting with AI in minutes!"
                },
                {
                    q: "Can I use multiple AI providers?",
                    a: "Yes! You can add API keys from multiple providers and switch between them based on your needs. Each provider has different strengths and pricing."
                },
                {
                    q: "Is there a usage limit?",
                    a: "There are no limits imposed by our platform. Your usage is only limited by your API provider's quotas and your API key's rate limits."
                },
                {
                    q: "Can I share my account?",
                    a: "Each account is designed for individual use. For team collaboration, we recommend each team member create their own account with their own API keys."
                }
            ]
        }
    ];

    const chatSites = getChatSites();
    const sysMsg = ``;

    return (
        <div className="min-h-screen bg-background">
            {/* Hero Section */}
            <section className="px-[34px] pt-4 pb-20">
                <div className="container mx-auto text-center">
                    <div className="animate-fade-in-up">
                        <h1 className="mb-6 font-bold text-5xl md:text-7xl bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent">
                            Got Questions?
                        </h1>
                        <p className="mb-6 mx-auto max-w-3xl text-muted-foreground text-xl leading-relaxed">
                            Find answers to common questions about pricing, security, features, and more.
                        </p>
                        <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-500/10 to-pink-500/10 px-4 py-2 border border-purple-500/20 text-purple-600">
                            <VercelIcon size={14} />
                            <Link href="https://vercel.com/templates/next.js/nextjs-ai-chatbot" target="_blank" rel="noreferrer" className="text-sm font-medium text-purple-600">Deploy with Vercel</Link>
                        </div>
                    </div>
                </div>
                <div className={`container mx-auto mt-6${sysMsg ? "" : " hidden"}`}>
                    <div className="rounded-2xl border bg-card px-6 py-4 text-sm text-muted-foreground text-left">
                        {sysMsg}
                    </div>
                </div>
            </section>

            {/* Pricing Highlight */}
            <section className="px-[34px] pb-16">
                <div className="container mx-auto">
                    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 p-12 text-center text-white">
                        <div className="absolute inset-0 bg-grid-white/10" />
                        <div className="relative z-10">
                            <div className="flex flex-wrap justify-center gap-6 text-left">
                                <div className="flex items-start gap-2">
                                    <CheckCircle2 className="h-5 w-5 mt-0.5" />
                                    <div>
                                        <div className="font-semibold">Bring your own Keys</div>
                                        <div className="text-sm text-white/80">No markup or fees</div>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <CheckCircle2 className="h-5 w-5 mt-0.5" />
                                    <div>
                                        <div className="font-semibold">Full Transparency</div>
                                        <div className="text-sm text-white/80">See exactly what you pay</div>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <CheckCircle2 className="h-5 w-5 mt-0.5" />
                                    <div>
                                        <div className="font-semibold">No Limits</div>
                                        <div className="text-sm text-white/80">Use as much as you need</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* FAQ Categories */}
            <section className="px-[34px] pt-0 pb-16">
                <div className="container mx-auto">
                    <div className="space-y-16">
                        {faqs.map((category, categoryIndex) => {
                            const CategoryIcon = category.icon;
                            const isBringYourOwnKeys = category.category === "Bring your own keys";
                            return (
                                <div
                                    key={category.category}
                                    className="faq-category"
                                    style={{
                                        animationDelay: `${categoryIndex * 100}ms`,
                                    }}
                                >
                                    {/* Category Header */}
                                    <div className="mb-8 flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-4">
                                            <div className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${category.gradient}`}>
                                                <CategoryIcon className="h-6 w-6 text-white" />
                                            </div>
                                            <h2 className="font-bold text-3xl">{category.category}</h2>
                                        </div>
                                        {isBringYourOwnKeys && (
                                            <Link
                                                href="/keys"
                                                className="ml-auto text-sm font-medium text-primary hover:underline"
                                            >
                                                Add Keys
                                            </Link>
                                        )}
                                    </div>

                                    {/* Questions */}
                                    <div className="grid gap-6 md:grid-cols-2">
                                        {category.questions.map((faq, faqIndex) => (
                                            <div
                                                key={faqIndex}
                                                className="group rounded-2xl border bg-card p-6 hover:shadow-lg transition-all duration-300 hover:scale-[1.02]"
                                            >
                                                <h3 className="mb-3 font-semibold text-lg group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text group-hover:from-purple-600 group-hover:to-pink-600 transition-all">
                                                    {faq.q}
                                                </h3>
                                                <p className="text-muted-foreground leading-relaxed">
                                                    {faq.a}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* Chat Sites */}
            {chatSites.length > 0 && (
                <section className="px-[34px] pb-16">
                    <div className="container mx-auto">
                        <div className="mb-8 flex items-center gap-4">
                            <div className="inline-flex p-3 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500">
                                <Globe className="h-6 w-6 text-white" />
                            </div>
                            <h2 className="font-bold text-3xl">Chat Sites</h2>
                        </div>
                        <div className="grid gap-6 md:grid-cols-3">
                            {chatSites.map((site) => (
                                <Link
                                    key={site.url}
                                    href={site.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="group rounded-2xl border bg-card p-6 hover:shadow-lg transition-all duration-300 hover:scale-[1.02]"
                                >
                                    <h3 className="mb-2 font-semibold text-lg group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text group-hover:from-indigo-500 group-hover:to-purple-500 transition-all">
                                        {site.title}
                                    </h3>
                                    {site.description && (
                                        <p className="text-muted-foreground text-sm leading-relaxed">
                                            {site.description}
                                        </p>
                                    )}
                                </Link>
                            ))}
                        </div>
                    </div>
                </section>
            )}

            {/* Still Have Questions */}
            <section className="px-[34px] py-20">
                <div className="container mx-auto">
                    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 p-12 text-center text-white">
                        <div className="absolute inset-0 bg-grid-white/10" />
                        <div className="relative z-10">
                            <Sparkles className="mx-auto mb-6 h-16 w-16" />
                            <h2 className="mb-4 font-bold text-4xl">Still Have Questions?</h2>
                            <p className="mx-auto mb-8 max-w-2xl text-lg text-white/90">
                                Join our community or start using the platform to experience it firsthand.
                                Our AI agents are ready to help you!
                            </p>
                            <div className="flex justify-center gap-4">
                                <Button asChild size="lg" variant="secondary">
                                    <Link href="/register">Get Started Free</Link>
                                </Button>
                                <Button asChild size="lg" className="bg-white text-purple-600 hover:bg-white/90">
                                    <Link href="/agents">Explore Agents</Link>
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <SiteFooter />
        </div>
    );
}
