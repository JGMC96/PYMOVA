import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export const Hero = () => {
  return (
    <section className="relative min-h-screen w-full bg-[#020617] text-slate-200 flex flex-col items-center overflow-hidden">
      {/* Background Orbs & Grid */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-900/30 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/20 blur-[120px] rounded-full" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-30" />
      </div>

      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center relative z-10 pt-32 pb-20">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/20 bg-cyan-500/5 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-8"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
          </span>
          Potenciado por IA contextual
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="max-w-4xl text-5xl md:text-7xl lg:text-8xl font-display font-extrabold tracking-tight text-white mb-8 leading-[1.05]"
        >
          El sistema operativo para{" "}
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-500 inline-block">
            tu negocio
          </span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="max-w-2xl text-lg md:text-xl text-slate-400 leading-relaxed mb-12"
        >
          Gestiona clientes, ventas, facturación y pagos en una sola plataforma unificada.
          Visualiza tu capital en tiempo real con inteligencia de negocio personalizada.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center gap-4"
        >
          <Link to="/auth?tab=register">
            <button className="group relative px-8 py-4 bg-cyan-700 rounded-xl text-white font-bold text-base overflow-hidden transition-all hover:bg-cyan-600 hover:shadow-[0_0_40px_rgba(8,145,178,0.4)]">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
              <span className="relative flex items-center gap-2">
                Comenzar gratis
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" strokeWidth={2.5} />
              </span>
            </button>
          </Link>

          <button className="px-8 py-4 bg-slate-900/50 border border-slate-800 rounded-xl text-slate-300 font-bold text-base hover:bg-slate-800 hover:text-white transition-all backdrop-blur-sm">
            Ver demostración
          </button>
        </motion.div>

        {/* Decorative Dashboard Preview */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-24 w-full max-w-5xl aspect-video rounded-2xl border border-slate-800 bg-slate-900/40 p-4 relative"
        >
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#020617] to-transparent pointer-events-none rounded-2xl" />
          <div className="w-full h-full rounded-lg border border-slate-800/50 bg-[#0a0f1e] overflow-hidden flex flex-col">
            <div className="h-8 border-b border-slate-800 flex items-center px-4 gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-700" />
              <div className="w-2 h-2 rounded-full bg-slate-700" />
              <div className="w-2 h-2 rounded-full bg-slate-700" />
            </div>
            <div className="flex-1 p-6 flex gap-6">
              <div className="w-1/3 space-y-4">
                <div className="h-12 bg-slate-800/40 rounded-lg" />
                <div className="h-32 bg-slate-800/20 rounded-lg" />
                <div className="h-8 bg-slate-800/30 rounded-lg w-2/3" />
              </div>
              <div className="flex-1">
                <div className="h-full bg-slate-800/30 rounded-lg relative overflow-hidden">
                  <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-cyan-500/20 to-transparent" />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </main>
    </section>
  );
};
