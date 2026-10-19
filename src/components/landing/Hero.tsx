import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import shareImage from "@/assets/pymova-share.jpg.asset.json";

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
          Gestión para pymes y comercios
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="max-w-4xl text-5xl md:text-7xl lg:text-8xl font-display font-extrabold tracking-tight text-white mb-8 leading-[1.05]"
        >
          Pymova:{" "}
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-500 inline-block">
            gestión para pymes
          </span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="max-w-2xl text-lg md:text-xl text-slate-400 leading-relaxed mb-12"
        >
          Para pequeñas empresas y comercios que necesitan gestionar clientes, facturas,
          cobros y equipos en un solo lugar. Con TPV, inventario y sincronización con Shopify
          para conectar la tienda física con las ventas online.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center gap-4"
        >
          <Button asChild variant="accent" size="lg">
            <Link to="/auth?tab=register">Crear cuenta <ArrowRight /></Link>
          </Button>
          <Button asChild variant="heroOutline" size="lg">
            <a href="#features">Explorar módulos</a>
          </Button>
        </motion.div>

        {/* Imagen de marca compartida con las vistas previas de enlaces */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-16 w-full max-w-3xl"
        >
          <img src={`https://pymova.com${shareImage.url}`} alt="Pymova: gestión para pymes y comercios, TPV e inventario, facturación y cobros, RRHH y Shopify" width={1200} height={630} loading="lazy" className="w-full h-auto rounded-lg" />
        </motion.div>
      </main>
    </section>
  );
};
