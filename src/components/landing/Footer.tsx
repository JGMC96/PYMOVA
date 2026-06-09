import { Zap } from "lucide-react";
import { Link } from "react-router-dom";

export const Footer = () => {
  return (
    <footer className="py-16 bg-sidebar text-sidebar-foreground">
      <div className="container px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-primary flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-display font-bold text-xl">
                Pymova
              </span>
            </Link>
            <p className="text-sm text-sidebar-foreground/60 leading-relaxed">
              El sistema operativo para tu negocio. Simple, inteligente y escalable.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold mb-4">Producto</h4>
            <ul className="space-y-2 text-sm text-sidebar-foreground/60">
              <li><a href="#features" className="hover:text-sidebar-foreground transition-colors">Funciones</a></li>
              <li><a href="#pricing" className="hover:text-sidebar-foreground transition-colors">Precios</a></li>
              <li><a href="#" className="hover:text-sidebar-foreground transition-colors">Integraciones</a></li>
              <li><a href="#" className="hover:text-sidebar-foreground transition-colors">API</a></li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-semibold mb-4">Empresa</h4>
            <ul className="space-y-2 text-sm text-sidebar-foreground/60">
              <li><a href="#" className="hover:text-sidebar-foreground transition-colors">Sobre nosotros</a></li>
              <li><a href="#" className="hover:text-sidebar-foreground transition-colors">Blog</a></li>
              <li><a href="#" className="hover:text-sidebar-foreground transition-colors">Carreras</a></li>
              <li><a href="#" className="hover:text-sidebar-foreground transition-colors">Contacto</a></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-sidebar-foreground/60">
              <li><a href="#" className="hover:text-sidebar-foreground transition-colors">Privacidad</a></li>
              <li><a href="#" className="hover:text-sidebar-foreground transition-colors">Términos</a></li>
              <li><a href="#" className="hover:text-sidebar-foreground transition-colors">Cookies</a></li>
              <li><a href="#" className="hover:text-sidebar-foreground transition-colors">GDPR</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-sidebar-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-sidebar-foreground/60">
            © {new Date().getFullYear()} Pymova AI. Todos los derechos reservados.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors">
              Twitter
            </a>
            <a href="#" className="text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors">
              LinkedIn
            </a>
            <a href="#" className="text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors">
              GitHub
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
