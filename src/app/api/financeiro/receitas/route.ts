import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ error: 'Financeiro desativado.' }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: 'Financeiro desativado.' }, { status: 410 });
}
