using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Interfaces
{
    public interface IRocketEngineControl
    {
        /// <summary>
        /// The amount of fuel remaining, one is used per frame where the engine is on.
        /// After fuel runs out, -ve numbers indicate the amount of frames since fuel ran out.
        /// </summary>
        float RemainingFuel { get; }

        /// <summary>
        /// Remaining delay before the engine starts.
        /// </summary>
        int StartDelay { get; set; }

        /// <summary>
        /// Remaining delay until the rocket starts turning
        /// </summary>
        int TurningStartDelay { get; set; }

        void FlyAtTargetMaxSpeed(PotentialTarget target);
        void FlyToTarget(PotentialTarget target, float approachVelocity, float absoluteLocationTollerance, float proportionalVelocityTollerance);
    }
}
