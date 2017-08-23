using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Interfaces
{
    public interface IDeactivatable
    {
        /// <summary>
        /// Permanently deactivates the component leaving it as a sitting duck.
        /// Also untaggs the component so it iwill not be targeted.
        /// </summary>
        void Deactivate();
    }
}
