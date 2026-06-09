import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { Link } from "react-router-dom";
import { PymovaLogo } from "./PymovaLogo";

export const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#020617]/70 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link to="/" className="group flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center border border-slate-800 shadow-lg group-hover:border-cyan-500/50 transition-colors">
              <PymovaLogo className="w-6 h-6" />
            </div>
            <span className="font-display font-bold text-xl tracking-tight text-white">
              Pymova
            </span>
          </Link>

          {/* Desktop navigation */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-400">
            <a href="#features" className="hover:text-white transition-colors">
              Funciones
            </a>
            <a href="#pricing" className="hover:text-white transition-colors">
              Precios
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Recursos
            </a>
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-4">
            <Link
              to="/auth"
              className="text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              Iniciar sesión
            </Link>
            <Link to="/auth?tab=register">
              <button className="px-5 py-2.5 bg-white text-slate-950 rounded-full text-sm font-semibold hover:bg-slate-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                Comenzar gratis
              </button>
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label={isMenuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={isMenuOpen}
            className="md:hidden p-2 rounded-lg hover:bg-white/5 transition-colors"
          >
            {isMenuOpen ? (
              <X className="w-5 h-5 text-white" />
            ) : (
              <Menu className="w-5 h-5 text-white" />
            )}
          </button>
        </div>

        {/* Mobile menu */}
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="md:hidden absolute top-20 left-0 right-0 bg-[#020617]/95 backdrop-blur-xl border-b border-white/5 p-6 space-y-4"
          >
            <a href="#features" className="block text-sm font-medium text-slate-400 hover:text-white transition-colors py-2">
              Funciones
            </a>
            <a href="#pricing" className="block text-sm font-medium text-slate-400 hover:text-white transition-colors py-2">
              Precios
            </a>
            <a href="#" className="block text-sm font-medium text-slate-400 hover:text-white transition-colors py-2">
              Recursos
            </a>
            <div className="flex flex-col gap-2 pt-4 border-t border-white/10">
              <Link to="/auth">
                <Button variant="outline" className="w-full">Iniciar sesión</Button>
              </Link>
              <Link to="/auth?tab=register">
                <button className="w-full px-5 py-2.5 bg-white text-slate-950 rounded-full text-sm font-semibold">
                  Comenzar gratis
                </button>
              </Link>
            </div>
          </motion.div>
        )}
      </div>
    </header>
  );
};
