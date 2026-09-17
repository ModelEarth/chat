import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import {
  Sparkles,
  Zap,
  Shield,
  ArrowRight,
  CheckCircle2,
  Globe,
  Lock
} from "lucide-react";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background overflow-hidden">

      {/* Hero Section with Animated Background */}
      <section className="relative px-[34px] pt-8 pb-24 overflow-hidden @container">
        {/* Animated gradient orbs */}
        <div className="absolute top-20 left-10 h-72 w-72 rounded-full bg-purple-500/20 blur-3xl animate-pulse" />
        <div className="absolute top-40 right-10 h-96 w-96 rounded-full bg-pink-500/20 blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute bottom-20 left-1/2 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />

        <div className="container mx-auto text-center relative z-10">
          <div className="animate-fade-in-up">
            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-500/10 to-pink-500/10 px-4 py-2 border border-purple-500/20 backdrop-blur-sm">
              <Sparkles className="h-4 w-4 text-purple-600 animate-pulse" />
              <Link href="/features" className="text-sm font-medium text-purple-600">Core Features</Link>
            </div>

            {/* Main Heading */}
            <h1 className="mb-6 font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent leading-tight text-2xl @sm:text-4xl @md:text-5xl @xl:text-7xl">
              Earthscape Chat
            </h1>

            {/* Subheading */}
            <p className="mx-auto mb-8 max-w-3xl text-muted-foreground text-xl md:text-2xl leading-relaxed">
              Abundance engineering and creative intelligence orchestration
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-wrap justify-center gap-4 mb-12">
              <Button asChild size="lg" className="bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 text-white text-lg px-8 py-6 group">
                <Link href="/register">
                  Get Started
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="text-lg px-8 py-6 border-2">
                <Link href="/agents">Explore Agents</Link>
              </Button>
            </div>

            {/* Social Proof */}
            <div className="flex flex-wrap justify-center gap-8 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span>No credit card required</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span>BYOM - Bring Your Own Models</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <Link href="/agents" className="cursor-pointer">6 specialized AI agents</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-[34px] py-20" id="features">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="mb-4 font-bold text-4xl md:text-5xl bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              Core Features
            </h2>
            <p className="mx-auto max-w-2xl text-muted-foreground text-lg">
              Everything you need for an exceptional AI experience
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="feature-card group relative overflow-hidden rounded-2xl border bg-card p-8 hover:shadow-2xl transition-all duration-300 hover:scale-105">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-cyan-500 opacity-0 group-hover:opacity-10 transition-opacity" />
              <div className="relative z-10">
                <div className="mb-4 inline-flex p-3 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500">
                  <Sparkles className="h-6 w-6 text-white" />
                </div>
                <h3 className="mb-3 font-semibold text-2xl">
                  Intelligent Conversations
                </h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Engage in natural, context-aware conversations with our advanced
                  AI powered by the latest language models.
                </p>
                <Link href="/features" className="text-blue-600 hover:underline inline-flex items-center gap-1 group/link">
                  Learn more
                  <ArrowRight className="h-4 w-4 group-hover/link:translate-x-1 transition-transform" />
                </Link>
              </div>
            </div>

            <div className="feature-card group relative overflow-hidden rounded-2xl border bg-card p-8 hover:shadow-2xl transition-all duration-300 hover:scale-105">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-pink-500 opacity-0 group-hover:opacity-10 transition-opacity" />
              <div className="relative z-10">
                <div className="mb-4 inline-flex p-3 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500">
                  <Zap className="h-6 w-6 text-white" />
                </div>
                <h3 className="mb-3 font-semibold text-2xl">
                  6 Specialized Agents
                </h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  From code execution to document processing, our AI agents
                  handle diverse tasks with expertise.
                </p>
                <Link href="/agents" className="text-purple-600 hover:underline inline-flex items-center gap-1 group/link">
                  Explore agents
                  <ArrowRight className="h-4 w-4 group-hover/link:translate-x-1 transition-transform" />
                </Link>
              </div>
            </div>

            <div className="feature-card group relative overflow-hidden rounded-2xl border bg-card p-8 hover:shadow-2xl transition-all duration-300 hover:scale-105">
              <div className="absolute inset-0 bg-gradient-to-br from-green-500 to-emerald-500 opacity-0 group-hover:opacity-10 transition-opacity" />
              <div className="relative z-10">
                <div className="mb-4 inline-flex p-3 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500">
                  <Shield className="h-6 w-6 text-white" />
                </div>
                <h3 className="mb-3 font-semibold text-2xl">
                  Secure & Private
                </h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Your conversations are protected with enterprise-grade security
                  and encryption. Your data stays yours.
                </p>
                <Link href="/faq" className="text-green-600 hover:underline inline-flex items-center gap-1 group/link">
                  Security details
                  <ArrowRight className="h-4 w-4 group-hover/link:translate-x-1 transition-transform" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why Free Section */}
      <section className="px-[34px] py-20 bg-muted/50">
        <div className="container mx-auto">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 p-12 md:p-16 text-white">
            <div className="absolute inset-0 bg-grid-white/10" />
            <div className="relative z-10 max-w-3xl mx-auto text-center">
              <Globe className="mx-auto mb-6 h-16 w-16" />
              <h2 className="mb-6 font-bold text-4xl md:text-5xl">Why It's Free</h2>
              <p className="mb-8 text-lg md:text-xl text-white/90 leading-relaxed">
                We believe AI should be accessible to everyone. By using your own API keys,
                you pay AI providers directly at their cost—no markups, no subscriptions,
                no hidden fees. Just pure, transparent AI power.
              </p>
              <div className="grid gap-6 md:grid-cols-3 text-left">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-6 w-6 mt-1 flex-shrink-0" />
                  <div>
                    <div className="font-semibold text-lg mb-1">No Subscription</div>
                    <div className="text-white/80">Use forever, completely free</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-6 w-6 mt-1 flex-shrink-0" />
                  <div>
                    <div className="font-semibold text-lg mb-1">Your API Keys</div>
                    <div className="text-white/80">Pay providers directly, no markup</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-6 w-6 mt-1 flex-shrink-0" />
                  <div>
                    <div className="font-semibold text-lg mb-1">Full Control</div>
                    <div className="text-white/80">Choose your providers and models</div>
                  </div>
                </div>
              </div>
              <div className="mt-8">
                <Button asChild size="lg" variant="secondary" className="text-lg px-8">
                  <Link href="/faq">Learn More</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-[34px] py-20">
        <div className="container mx-auto">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 p-12 md:p-16 text-center text-white">
            <div className="absolute inset-0 bg-grid-white/10" />
            <div className="relative z-10">
              <Lock className="mx-auto mb-6 h-16 w-16" />
              <h2 className="mb-4 font-bold text-4xl md:text-5xl">Ready to Get Started?</h2>
              <p className="mx-auto mb-8 max-w-2xl text-lg md:text-xl text-white/90">
                Join thousands of users already experiencing the future of AI-powered conversations.
                No credit card required. Start chatting in minutes.
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <Button asChild size="lg" variant="secondary" className="text-lg px-8 py-6">
                  <Link href="/register">
                    Start Free Now
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-white text-white hover:bg-white hover:text-purple-600 text-lg px-8 py-6">
                  <Link href="/features">View All Features</Link>
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
