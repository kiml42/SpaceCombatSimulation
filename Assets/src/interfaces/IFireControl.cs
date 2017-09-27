using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Interfaces
{
    public interface IFireControl
    {
        /// <summary>
        /// Should shoot at the given target
        /// </summary>
        /// <param name="target"></param>
        /// <returns></returns>
        bool ShouldShoot(Target target);

        /// <summary>
        /// Shouldshoot at the target given by some other means.
        /// </summary>
        /// <returns></returns>
        bool ShouldShoot();
    }
}
