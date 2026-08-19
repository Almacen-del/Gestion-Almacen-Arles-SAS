# 🏗️ Plan de Refactorización de App.tsx

## 📊 Estado Actual

| Métrica | Valor | Estado |
|---------|-------|--------|
| Líneas de código | 2500+ | 🔴 Muy grande |
| Componentes | 1 monolítico | 🔴 Crítico |
| Responsabilidades | 15+ | 🔴 Demasiadas |
| Archivos relacionados | 40+ | ⚠️ Acoplamiento alto |
| Complejidad ciclomática | muy alta | 🔴 Difícil mantener |

## 🎯 Objetivo

Refactorizar App.tsx de **2500+ líneas** a **componentes especializados** con:
- ✅ Máximo 800 líneas el componente principal
- ✅ Componentes reutilizables y testables
- ✅ Separación clara de responsabilidades
- ✅ Estado compartido vía Context API
- ✅ Mantenibilidad mejorada

## 🏗️ Estructura Propuesta

```
src/
├── App.tsx (core de routing + state)
├── contexts/
│   ├── AuthContext.tsx (usuario, auth)
│   ├── InventoryContext.tsx (artículos, caché)
│   └── UIContext.tsx (theme, sidebar, modales)
├── layouts/
│   ├── MainLayout.tsx (header + sidebar + content)
│   └── StartupLayout.tsx (pantalla inicial)
├── pages/
│   ├── InventoryPage.tsx (panel inventario)
│   ├── ValuationPage.tsx (panel valoración)
│   ├── AnalysisPage.tsx (panel análisis)
│   └── SettingsPage.tsx (configuración)
├── components/
│   ├── Header/
│   │   ├── Header.tsx
│   │   ├── UserMenu.tsx
│   │   └── SearchBar.tsx
│   ├── Sidebar/
│   │   ├── Sidebar.tsx
│   │   ├── ModuleList.tsx
│   │   └── CollapsibleSection.tsx
│   ├── Inventory/
│   │   ├── InventoryTable.tsx
│   │   ├── EntryForm.tsx
│   │   └── ExitForm.tsx
│   ├── Valuation/
│   │   ├── ValuationTable.tsx
│   │   ├── ValuationModal.tsx
│   │   └── ManualEntry.tsx
│   ├── Analysis/
│   │   ├── AnalysisCards.tsx
│   │   ├── Charts.tsx
│   │   └── Insights.tsx
│   └── Modals/
│       ├── QRAssignModal.tsx
│       ├── ConfirmModal.tsx
│       └── AlertModal.tsx
└── hooks/
    ├── useAuthContext.ts
    ├── useInventoryContext.ts
    ├── useUIContext.ts
    └── useUserRoleListener.ts (ya creado)
```

## 📝 Fases de Refactorización

### **Fase 1: Crear Contexts** (2-3 horas)

#### 1.1 AuthContext.tsx
```typescript
interface AuthContextValue {
  user: User | null;
  checking: boolean;
  authorizationStatus: AuthorizationStatus;
  authorizationAttempt: number;
  logout: () => Promise<void>;
}

// Mover estado de App.tsx:
// - user
// - checking
// - authorizationStatus
// - authorizationAttempt
```

**Archivos a mover:**
- `verifyUserAuthorization()` logic
- `handleAuthStateChange()` logic

#### 1.2 InventoryContext.tsx
```typescript
interface InventoryContextValue {
  articles: ArticuloInventario[];
  loading: boolean;
  error: Error | null;
  cache: PanelCache;
  refresh: () => Promise<void>;
  search: (query: string) => ArticuloInventario[];
}

// Mover estado:
// - articulosConValorActual
// - isLoadingArticulos
// - panelCache
// - cacheStatus
```

**Archivos a mover:**
- `loadArticulos()` logic
- `refreshArticulos()` logic
- Cache management

#### 1.3 UIContext.tsx
```typescript
interface UIContextValue {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  currentPanel: string;
  setCurrentPanel: (panel: string) => void;
  modals: Record<string, boolean>;
  openModal: (name: string) => void;
  closeModal: (name: string) => void;
  theme: Theme;
}

// Mover estado:
// - isCollapsed
// - currentPanel
// - Modales abiertos
```

### **Fase 2: Crear Layouts** (2 horas)

#### 2.1 MainLayout.tsx
```typescript
export function MainLayout() {
  const { user, checking } = useAuthContext();
  
  if (checking) return <LoadingScreen />;
  
  return (
    <div className="app-container">
      <Header />
      <Sidebar />
      <main className="main-content">
        <Outlet /> {/* React Router */}
      </main>
    </div>
  );
}
```

**Componentes:**
- Header (refactorizado)
- Sidebar (refactorizado)
- Main content area

### **Fase 3: Crear Pages** (4-5 horas)

#### 3.1 InventoryPage.tsx
Mover toda la lógica del panel de inventario:
- Tabla de artículos
- Formularios de entrada/salida
- Buscar/filtrar
- Actualización de valores
- Estados vacíos

#### 3.2 ValuationPage.tsx
Mover toda la lógica de valoración:
- Tabla de valoración
- Modales de edición
- Cierre mensual
- Histórico

#### 3.3 AnalysisPage.tsx
Mover análisis de inventario:
- Tarjetas de indicadores
- Gráficos
- Insights
- Clasificación ABC

#### 3.4 SettingsPage.tsx
Configuración y admin:
- Gestión de usuarios
- Parámetros de rol
- Logs/debugging
- Información de la app

### **Fase 4: Refactorizar Componentes** (3-4 horas)

Dividir componentes grandes:
- Header → Header + UserMenu + SearchBar
- Sidebar → Sidebar + ModuleList + CollapsibleSection
- Tablas grandes → Componentes separados

### **Fase 5: Actualizar Hooks** (1-2 horas)

Crear custom hooks para cada contexto:
```typescript
export function useAuthContext() { return useContext(AuthContext); }
export function useInventoryContext() { return useContext(InventoryContext); }
export function useUIContext() { return useContext(UIContext); }
```

### **Fase 6: Routing (React Router)** (2-3 horas)

Implementar routing:
```typescript
<BrowserRouter>
  <Routes>
    <Route element={<MainLayout />}>
      <Route path="inventory" element={<InventoryPage />} />
      <Route path="valuation" element={<ValuationPage />} />
      <Route path="analysis" element={<AnalysisPage />} />
      <Route path="settings" element={<SettingsPage />} />
    </Route>
    <Route path="startup" element={<StartupScreen />} />
  </Routes>
</BrowserRouter>
```

**Cambios:**
- Install: `npm install react-router-dom`
- Routing por panel
- Deep linking posible

## 🔄 Orden de Implementación Recomendado

1. **Crear Contexts** → Definir interfaces y providers
2. **Crear Layouts** → MainLayout funcional
3. **Crear Pages** → Mover lógica de App.tsx
4. **Refactorizar Componentes** → Divorciar responsabilidades
5. **Agregar Routing** → React Router
6. **Testing** → Tests actualizados

## ⚙️ Cambios a Archivos Existentes

### App.tsx (Después)
```typescript
// De 2500+ líneas a ~150-200 líneas
export function App() {
  const { checking } = useAuthContext();

  if (checking) {
    return <StartupScreen state="loading" />;
  }

  return <MainLayout />;
}
```

### main.tsx (Sin cambios)
- Sigue usando StartupScreen
- Sigue usando ErrorBoundary
- Envuelve todo en providers

## 📦 Nueva estructura de imports

```typescript
// Antes (todos en App.tsx)
import { longaListaDeImports } from 'App.tsx'

// Después (distribuido)
import { useAuthContext } from './contexts/AuthContext'
import { MainLayout } from './layouts/MainLayout'
import { InventoryPage } from './pages/InventoryPage'
// Más limpio y específico
```

## ✅ Beneficios Esperados

| Aspecto | Antes | Después |
|--------|-------|---------|
| Líneas App.tsx | 2500+ | ~150 |
| Componentes | 1 | 20+ |
| Mantenibilidad | 🔴 Muy difícil | 🟢 Fácil |
| Testing | ⚠️ Complejo | 🟢 Independiente |
| Performance | ⚠️ Monolítico | 🟢 Code splitting |
| Deep linking | ❌ No | ✅ Sí |
| Reutilización | ❌ No | ✅ Sí |

## 🚀 Estimación de Tiempo

| Fase | Horas | Complejidad |
|------|-------|-------------|
| 1. Contexts | 2-3 | Media |
| 2. Layouts | 2 | Media |
| 3. Pages | 4-5 | Alta |
| 4. Componentes | 3-4 | Media |
| 5. Hooks | 1-2 | Baja |
| 6. Routing | 2-3 | Media |
| **TOTAL** | **14-18** | - |

**Nota:** Se puede hacer en paralelo, estimado 8-10 horas en equipo o dedicadas en bloques.

## 🧪 Validación

Después de cada fase:
- [ ] `npm run build` → Sin errores
- [ ] `npm test` → 125/125 tests pasando
- [ ] Componentes funcionan correctamente
- [ ] No hay prop drilling excesivo
- [ ] Context se usa eficientemente

## 📋 Checklist Pre-Refactorización

- [ ] Backup de App.tsx actual
- [ ] Todos los tests pasando
- [ ] Build sin errores
- [ ] Documentar parámetros de funciones grandes
- [ ] Crear rama git para refactorización

## 💡 Alternativa: Refactorización Incremental

Si no hay tiempo para refactorización completa:

1. **Fase mínima (6-8 horas):**
   - Crear AuthContext (usuarios + auth)
   - Crear MainLayout (header + sidebar)
   - Crear InventoryPage (mover tabla)
   - Resultado: App.tsx pasa de 2500 a ~800 líneas

2. **Fase intermedia (+4-5 horas):**
   - Agregar InventoryContext
   - Crear ValuationPage
   - Crear AnalysisPage

3. **Fase completa (+6-8 horas):**
   - UIContext y Settings
   - Routing con React Router
   - Pruebas exhaustivas

---

**Fecha:** 2024-01-20  
**Estado:** 📋 Plan listo para implementación  
**Prioridad:** 🟡 Alta (después de logging)
