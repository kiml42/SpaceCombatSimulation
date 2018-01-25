using Moq;
using System;
using System.Collections.Generic;
using Xunit;

namespace AutoTurretTests
{
    public class TurretControllerTest
    {
        TurretController _controller;

        public TurretControllerTest()
        {
            _controller = new TurretController();
        }

        [Fact]
        public void UpdateCallsGetTarget()
        {
            //_controller.Update();

        }
    }
}
