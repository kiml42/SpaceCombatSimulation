using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Health
{
    public class DamagePacket
    {
        public float Damage;
        public bool IsAOE = false;

        public DamagePacket(float damage, bool aoe = false)
        {
            Damage = damage;
            IsAOE = aoe;
        }
    }
}
