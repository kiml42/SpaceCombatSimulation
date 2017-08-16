using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Interfaces
{
    public interface IFireControl
    {
        bool ShouldShoot(PotentialTarget target);
        void Shoot(bool shouldShoot);
        bool ShootIfAimed(PotentialTarget target);
    }
}
