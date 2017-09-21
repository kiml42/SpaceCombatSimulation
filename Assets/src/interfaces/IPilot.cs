using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Interfaces
{
    public interface IPilot
    {
        /// <summary>
        /// Remaining delay before the engine starts.
        /// </summary>
        int StartDelay { get; set; }

        /// <summary>
        /// Remaining delay until the rocket starts turning
        /// </summary>
        int TurningStartDelay { get; set; }
        
        void Fly(PotentialTarget target);
    }
}
