import Link from 'next/link';
import { MessageSquare, Upload, Share2, Zap } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <nav className="flex justify-between items-center">
          <div className="text-2xl font-bold text-primary-600">ChatFlow</div>
          <div className="flex gap-4">
            <Link href="/login" className="px-4 py-2 text-gray-600 hover:text-gray-900">
              Login
            </Link>
            <Link href="/register" className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-6">
          Create Your Own AI Chatbot
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          Build custom AI assistants with your own knowledge base. Share them with a link or embed on your website.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/register" className="px-8 py-3 bg-primary-600 text-white rounded-lg text-lg font-medium hover:bg-primary-700">
            Start Building Free
          </Link>
          <Link href="#demo" className="px-8 py-3 border-2 border-gray-300 text-gray-700 rounded-lg text-lg font-medium hover:border-gray-400">
            See Demo
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center p-6">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Upload className="w-8 h-8 text-primary-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Upload Knowledge</h3>
            <p className="text-gray-600">
              Add documents, PDFs, or paste website URLs to train your chatbot
            </p>
          </div>
          <div className="text-center p-6">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-8 h-8 text-primary-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Get Shareable Link</h3>
            <p className="text-gray-600">
              Receive a unique chat URL that anyone can access without signing in
            </p>
          </div>
          <div className="text-center p-6">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Zap className="w-8 h-8 text-primary-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Embed Anywhere</h3>
            <p className="text-gray-600">
              Add to your website with one line of code or use our REST API
            </p>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="bg-gray-50 py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Perfect For</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              'Customer Support',
              'Study Assistant',
              'Product FAQ',
              'Documentation Bot',
              'Training Helper',
              'Knowledge Base',
              'Research Assistant',
              'Personal Tutor'
            ].map((useCase) => (
              <div key={useCase} className="bg-white p-6 rounded-lg shadow-sm text-center">
                <p className="font-medium text-gray-800">{useCase}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-20 text-center">
        <h2 className="text-3xl font-bold mb-4">Ready to Build Your Chatbot?</h2>
        <p className="text-xl text-gray-600 mb-8">
          Get started for free. No credit card required.
        </p>
        <Link href="/register" className="px-8 py-3 bg-primary-600 text-white rounded-lg text-lg font-medium hover:bg-primary-700">
          Create Your Bot Now
        </Link>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="container mx-auto px-4 text-center">
          <p className="text-gray-400">© 2026 ChatFlow. Built with ❤️ for developers.</p>
        </div>
      </footer>
    </main>
  );
}