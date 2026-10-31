import type { CategoryColor, CategoryIcon, CategoryType } from "./categories";

export type DefaultCategory = {
  name: string;
  type: CategoryType;
  icon: CategoryIcon;
  color: CategoryColor;
  isFixed?: boolean;
  children?: { name: string; icon?: CategoryIcon; isFixed?: boolean }[];
};

/** The list every new space starts with. Generic names only. */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  {
    name: "Moradia",
    type: "EXPENSE",
    icon: "House",
    color: "amber",
    children: [
      { name: "Aluguel", isFixed: true },
      { name: "Condomínio", icon: "Building2", isFixed: true },
      { name: "Contas da casa", icon: "Lightbulb", isFixed: true },
      { name: "Manutenção", icon: "Wrench" },
    ],
  },
  {
    name: "Alimentação",
    type: "EXPENSE",
    icon: "Utensils",
    color: "orange",
    children: [
      { name: "Mercado", icon: "ShoppingCart" },
      { name: "Restaurante", icon: "UtensilsCrossed" },
      { name: "Delivery", icon: "Bike" },
      { name: "Padaria e lanches", icon: "Croissant" },
    ],
  },
  {
    name: "Transporte",
    type: "EXPENSE",
    icon: "Car",
    color: "sky",
    children: [
      { name: "Combustível", icon: "Fuel" },
      { name: "Transporte público", icon: "Bus" },
      { name: "App de transporte", icon: "CarTaxiFront" },
      { name: "Estacionamento e pedágio", icon: "ParkingCircle" },
      { name: "Manutenção do veículo", icon: "Wrench" },
    ],
  },
  {
    name: "Saúde",
    type: "EXPENSE",
    icon: "HeartPulse",
    color: "red",
    children: [
      { name: "Plano de saúde", isFixed: true },
      { name: "Farmácia", icon: "Pill" },
      { name: "Consultas e exames", icon: "Stethoscope" },
    ],
  },
  {
    name: "Educação",
    type: "EXPENSE",
    icon: "GraduationCap",
    color: "blue",
    children: [
      { name: "Mensalidade", isFixed: true },
      { name: "Cursos" },
      { name: "Livros e material", icon: "BookOpen" },
    ],
  },
  {
    name: "Lazer",
    type: "EXPENSE",
    icon: "Ticket",
    color: "violet",
    children: [
      { name: "Viagens", icon: "Plane" },
      { name: "Passeios e eventos" },
      { name: "Hobbies", icon: "Gamepad2" },
    ],
  },
  {
    name: "Compras",
    type: "EXPENSE",
    icon: "ShoppingBag",
    color: "pink",
    children: [
      { name: "Roupas", icon: "Shirt" },
      { name: "Eletrônicos", icon: "Laptop" },
      { name: "Casa e decoração", icon: "Sofa" },
    ],
  },
  {
    name: "Cuidados pessoais",
    type: "EXPENSE",
    icon: "Sparkles",
    color: "teal",
    children: [
      { name: "Beleza", icon: "Scissors" },
      { name: "Academia", icon: "Dumbbell" },
    ],
  },
  {
    name: "Assinaturas e serviços",
    type: "EXPENSE",
    icon: "Repeat",
    color: "lime",
    children: [
      { name: "Streaming", icon: "Tv" },
      { name: "Apps e software", icon: "Laptop" },
      { name: "Celular e internet", icon: "Smartphone", isFixed: true },
    ],
  },
  { name: "Pets", type: "EXPENSE", icon: "PawPrint", color: "amber" },
  { name: "Presentes e doações", type: "EXPENSE", icon: "Gift", color: "pink" },
  {
    name: "Impostos e tarifas",
    type: "EXPENSE",
    icon: "Landmark",
    color: "slate",
    children: [
      { name: "Impostos" },
      { name: "Tarifas bancárias", icon: "Receipt" },
      { name: "Juros e multas", icon: "Percent" },
    ],
  },
  { name: "Outros", type: "EXPENSE", icon: "CircleEllipsis", color: "slate" },

  { name: "Salário", type: "INCOME", icon: "Briefcase", color: "green" },
  { name: "Freelance", type: "INCOME", icon: "Laptop", color: "teal" },
  { name: "Rendimentos", type: "INCOME", icon: "TrendingUp", color: "blue" },
  { name: "Reembolsos", type: "INCOME", icon: "Undo2", color: "sky" },
  { name: "Presentes recebidos", type: "INCOME", icon: "Gift", color: "pink" },
  { name: "Outras receitas", type: "INCOME", icon: "CircleEllipsis", color: "slate" },
];
