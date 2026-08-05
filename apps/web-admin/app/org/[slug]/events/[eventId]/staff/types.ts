export interface StaffAccount {
  id: string;
  display_name: string;
  username: string;
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
