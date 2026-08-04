export interface StaffAccount {
  id: string;
  display_name: string;
  username: string;
  role: 'arbitre_table' | 'event_staff';
  status: 'active' | 'disabled';
  liceIds: string[];
}

export interface Lice {
  id: string;
  name: string;
}

export interface EventInfo {
  id: string;
  slug: string;
  name: string;
}
